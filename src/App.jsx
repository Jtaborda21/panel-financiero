import React, { useState, useMemo, useEffect, useRef, useCallback, memo } from "react";
import { Plus, Trash2, ArrowDownWideNarrow, Flame, CalendarDays, Zap, X, Pencil, ChevronDown, RefreshCw } from "lucide-react";
import { supabase } from "./supabaseClient";

/* ------------------------------------------------------------------ */
/* Utilidades puras                                                    */
/* ------------------------------------------------------------------ */

const uid = () => Math.random().toString(36).slice(2, 9);

const DEFAULT_ITEMS = [
  { id: uid(), type: "fijo", name: "Arriendo / vivienda", amount: 0 },
  { id: uid(), type: "fijo", name: "Comida", amount: 0 },
  { id: uid(), type: "fijo", name: "Transporte", amount: 0 },
  { id: uid(), type: "fijo", name: "Universidad (matrícula, materiales)", amount: 0 },
  { id: uid(), type: "fijo", name: "Servicios y celular", amount: 0 },
  { id: uid(), type: "deuda", name: "Deuda 1", balance: 0, rate: 0, minPayment: 0, totalInstallments: "", dueDay: "", deadlineDate: "", deadlineNote: "" },
];

const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function daysUntilDue(dueDay, today) {
  const day = Number(dueDay);
  if (!day || day < 1 || day > 31) return null;
  const todayDate = today.getDate();
  if (day >= todayDate) return day - todayDate;
  const daysInThisMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  return daysInThisMonth - todayDate + day;
}

function daysUntilDate(dateStr, today) {
  if (!dateStr) return null;
  const target = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(target.getTime())) return null;
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - todayMidnight) / 86400000);
}

function fmt(n) {
  const v = Number.isFinite(n) ? n : 0;
  return v.toLocaleString("es-CO", { maximumFractionDigits: 0 });
}

function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${d.getMonth() + 1}`;
}

// Simulación mensual del plan de pago (avalancha o bola de nieve).
// Una "deuda" con tasa 0% y fecha límite funciona igual de bien para
// modelar una meta de ahorro (el "saldo" es lo que falta reunir).
function simulateDebtPlan(debtsInput, extraBudget, method) {
  let active = debtsInput
    .filter((d) => d.balance > 0)
    .map((d) => ({ ...d, balance: Number(d.balance), minPayment: Number(d.minPayment) }));
  if (active.length === 0) return { months: 0, totalInterest: 0, order: [], unsustainable: false };

  let months = 0;
  let totalInterest = 0;
  let extraPool = extraBudget;
  const payoffOrder = [];
  const MAX_MONTHS = 600;

  while (active.length > 0 && months < MAX_MONTHS) {
    months++;
    active.forEach((d) => {
      const interest = d.balance * (d.rate / 100);
      d.balance += interest;
      totalInterest += interest;
    });

    active.sort((a, b) => (method === "avalanche" ? b.rate - a.rate : a.balance - b.balance));

    let pool = extraPool;
    active.forEach((d, idx) => {
      let pay = d.minPayment;
      if (idx === 0) pay += pool;
      pay = Math.min(pay, d.balance);
      d.balance -= pay;
    });

    const stillActive = [];
    active.forEach((d) => {
      if (d.balance <= 0.5) {
        payoffOrder.push({ name: d.name, month: months });
        extraPool += d.minPayment;
      } else {
        stillActive.push(d);
      }
    });
    active = stillActive;
  }

  return { months, totalInterest, order: payoffOrder, unsustainable: active.length > 0 };
}

// Sugiere un pago mínimo razonable a partir del saldo, la tasa mensual y
// (si existe) el número de cuotas. Con cuotas definidas usa la fórmula de
// cuota fija de amortización (la que cobra un banco en una compra a
// cuotas); sin cuotas, usa interés del mes + 2% del saldo (típico de una
// deuda revolvente sin plazo fijo, como una tarjeta de crédito).
function suggestMinPayment(balance, ratePercent, cuotas) {
  const n = Number(cuotas);
  const i = Number(ratePercent) / 100;
  if (n > 0) {
    if (i > 0) {
      const factor = i / (1 - Math.pow(1 + i, -n));
      return Math.round(balance * factor);
    }
    return Math.round(balance / n);
  }
  if (i > 0) return Math.round(balance * i + balance * 0.02);
  return null;
}

/* ------------------------------------------------------------------ */
/* Componentes de presentación                                        */
/* ------------------------------------------------------------------ */

// Gráfico sencillo de barras: ingresos vs gastos mes a mes.
const MonthlyChart = memo(function MonthlyChart({ data }) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.income, d.expenses)));
  const barW = 16;
  const gap = 10;
  const groupW = barW * 2 + 4;
  const chartH = 90;
  const width = data.length * (groupW + gap) + gap;
  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={width} height={chartH + 22} viewBox={`0 0 ${width} ${chartH + 22}`} style={{ display: "block", minWidth: "100%" }}>
        {data.map((d, i) => {
          const x = gap + i * (groupW + gap);
          const incomeH = (d.income / max) * chartH;
          const expenseH = (d.expenses / max) * chartH;
          return (
            <g key={d.key}>
              <rect x={x} y={chartH - incomeH} width={barW} height={incomeH} fill="var(--free)" rx="1.5" />
              <rect x={x + barW + 4} y={chartH - expenseH} width={barW} height={expenseH} fill="var(--debt)" rx="1.5" />
              <text x={x + groupW / 2} y={chartH + 15} textAnchor="middle" fontSize="9" fontFamily="-apple-system, sans-serif" fill="#6b6455">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
});

const ChartLegend = memo(function ChartLegend() {
  return (
    <div style={{ display: "flex", gap: 14, marginTop: 6, fontFamily: "-apple-system, sans-serif", fontSize: "0.72rem", color: "#6b6455" }}>
      <span><span className="legend-dot" style={{ background: "var(--free)" }} />Ingresos</span>
      <span><span className="legend-dot" style={{ background: "var(--debt)" }} />Gastos</span>
    </div>
  );
});

function Header({ email, onRefresh, onSignOut }) {
  return (
    <div className="session-bar">
      <span>Sesión: <b style={{ color: "#e0d9c4" }}>{email}</b></span>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button className="ghost-icon-btn" onClick={onRefresh} title="Refrescar">
          <RefreshCw size={14} />
        </button>
        <button className="ghost-text-btn" onClick={onSignOut}>cerrar sesión</button>
      </div>
    </div>
  );
}

const StatsSnapshot = memo(function StatsSnapshot({ totalIncome, totalExpenses, totalMinPayments, disponible }) {
  return (
    <div className="snapshot">
      <div className="stat"><div className="label">Ingreso total</div><div className="value">${fmt(totalIncome)}</div></div>
      <div className="stat"><div className="label">Gastos fijos</div><div className="value">${fmt(totalExpenses)}</div></div>
      <div className="stat"><div className="label">Pago mínimo deudas</div><div className="value">${fmt(totalMinPayments)}</div></div>
      <div className={`stat ${disponible >= 0 ? "free" : "debt"}`}>
        <div className="label">{disponible >= 0 ? "Disponible extra" : "Déficit"}</div>
        <div className="value">${fmt(Math.abs(disponible))}</div>
      </div>
    </div>
  );
});

function AuthScreen({ mode, email, password, error, msg, submitting, onEmailChange, onPasswordChange, onSubmit, onToggleMode }) {
  return (
    <div className="ledger">
      <style>{AUTH_STYLES}</style>
      <h1>Panel financiero</h1>
      <p>
        {mode === "signup"
          ? "Crea una cuenta para guardar tus datos y verlos desde cualquier dispositivo iniciando sesión con el mismo correo."
          : "Inicia sesión con tu correo y contraseña para ver tus datos."}
      </p>
      {error && <p style={{ color: "#e79aa6" }}>{error}</p>}
      {msg && <p style={{ color: "#a9d4ab" }}>{msg}</p>}
      <input type="email" placeholder="Correo" value={email}
        onChange={(e) => onEmailChange(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onSubmit()} />
      <input type="password" placeholder="Contraseña" value={password}
        onChange={(e) => onPasswordChange(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onSubmit()} />
      <button onClick={onSubmit} disabled={submitting}>
        {submitting ? "..." : mode === "signup" ? "Crear cuenta" : "Entrar"}
      </button>
      <button className="linkbtn" onClick={onToggleMode}>
        {mode === "signup" ? "Ya tengo cuenta" : "Crear una cuenta nueva"}
      </button>
    </div>
  );
}

// Línea de estado (vencimiento, cuotas restantes, plazo límite) compartida
// entre la vista resumida y la vista expandida de una deuda/cuota.
const DebtStatusLine = memo(function DebtStatusLine({ item, now }) {
  const dueIn = daysUntilDue(item.dueDay, now);
  const cuotasRestantes = Number(item.minPayment) > 0 ? Math.ceil(Number(item.balance) / Number(item.minPayment)) : null;
  const deadlineDays = daysUntilDate(item.deadlineDate, now);
  if (dueIn === null && cuotasRestantes === null && deadlineDays === null) return null;

  return (
    <div className="status-line">
      {dueIn !== null && (
        <span style={{ color: dueIn <= 3 ? "var(--debt)" : "#8a7a3d" }}>
          {dueIn === 0 ? "Vence hoy" : `${dueIn} día${dueIn === 1 ? "" : "s"} para tu próximo pago`}
        </span>
      )}
      {cuotasRestantes !== null && (
        <span style={{ color: "#6b6455" }}>
          ~{cuotasRestantes}{item.totalInstallments ? ` de ${item.totalInstallments}` : ""} cuota{cuotasRestantes === 1 ? "" : "s"} restante{cuotasRestantes === 1 ? "" : "s"}
        </span>
      )}
      {deadlineDays !== null && (
        <span style={{ color: deadlineDays <= 7 ? "var(--debt)" : "#8a7a3d" }}>
          {deadlineDays < 0
            ? `Plazo vencido${item.deadlineNote ? ` — ${item.deadlineNote}` : ""}`
            : deadlineDays === 0
            ? `¡Plazo hoy!${item.deadlineNote ? ` — ${item.deadlineNote}` : ""}`
            : `${deadlineDays} día${deadlineDays === 1 ? "" : "s"} para el plazo${item.deadlineNote ? ` (${item.deadlineNote})` : ""}`}
        </span>
      )}
    </div>
  );
});

// Input de dinero: muestra el valor con puntos de miles (estilo es-CO) y en
// negrilla, igual que los saldos de deuda, pero guarda un número plano.
const MoneyInput = memo(function MoneyInput({ value, onChange, className = "", placeholder }) {
  const display = value === "" || value === null || value === undefined ? "" : fmt(Number(value));
  return (
    <input
      type="text"
      inputMode="numeric"
      className={`money-input ${className}`.trim()}
      placeholder={placeholder}
      value={display}
      onChange={(ev) => {
        const digits = ev.target.value.replace(/[^\d]/g, "");
        onChange(digits === "" ? "" : String(Number(digits)));
      }}
    />
  );
});

// Fila editable de un ingreso extra o gasto inesperado: la descripción y el
// monto se pueden corregir después de agregados, igual que en las demás listas.
const MiniListItem = memo(function MiniListItem({ x, onUpdate, onRemove }) {
  return (
    <div className="item">
      <span className="mini-edit-fields">
        <input type="text" value={x.desc} onChange={(ev) => onUpdate(x.id, "desc", ev.target.value)} />
        <span className="day">día {x.day}</span>
      </span>
      <span className="mini-edit-amt">
        <MoneyInput value={x.amount} onChange={(val) => onUpdate(x.id, "amount", val)} />
        <button className="del" onClick={() => onRemove(x.id)}><Trash2 size={13} /></button>
      </span>
    </div>
  );
});

const FixedExpenseRow = memo(function FixedExpenseRow({ item, onUpdate, onRemove }) {
  return (
    <div className="row">
      <span className="type-tag fijo">Fijo</span>
      <input type="text" value={item.name} onChange={(ev) => onUpdate(item.id, "name", ev.target.value)} />
      <MoneyInput value={item.amount} onChange={(val) => onUpdate(item.id, "amount", val)} />
      <button className="del" onClick={() => onRemove(item.id)}><Trash2 size={15} /></button>
    </div>
  );
});

// Una deuda, tarjeta o compra a cuotas — también sirve para modelar una
// meta de ahorro (tasa 0%, saldo = lo que falta reunir, fecha límite = meta).
const DebtItem = memo(function DebtItem({ item, now, expanded, onToggleExpand, onRemove, onUpdate, onUpdateInstallments, onUpdateRate }) {
  if (!expanded) {
    return (
      <div className="debt-card">
        <div className="debt-card-top">
          <span className="type-tag deuda">Deuda/cuota</span>
          <span className="debt-card-name">{item.name}</span>
          <div className="debt-card-actions">
            <button className="icon-btn" onClick={() => onToggleExpand(item.id)} title="Editar"><Pencil size={13} /></button>
            <button className="icon-btn" onClick={() => onRemove(item.id)} title="Eliminar"><Trash2 size={13} /></button>
          </div>
        </div>
        <div className="debt-card-numbers">
          <span className="debt-card-balance">${fmt(Number(item.balance))}</span>
          {Number(item.rate) > 0 && <span className="chip-mini">{item.rate}% mensual</span>}
          {Number(item.minPayment) > 0 && <span className="chip-mini">mín ${fmt(Number(item.minPayment))}</span>}
        </div>
        <DebtStatusLine item={item} now={now} />
      </div>
    );
  }

  return (
    <div className="debt-card-expanded">
      <div className="row" style={{ borderBottom: "none", paddingBottom: 2 }}>
        <span className="type-tag deuda">Deuda/cuota</span>
        <input type="text" value={item.name} onChange={(ev) => onUpdate(item.id, "name", ev.target.value)} />
        <button className="icon-btn" onClick={() => onToggleExpand(item.id)} title="Listo"><ChevronDown size={15} /></button>
        <button className="del" onClick={() => onRemove(item.id)}><Trash2 size={15} /></button>
      </div>

      <div className="subfields">
        <label>Saldo
          <input type="number" value={item.balance} onChange={(ev) => onUpdate(item.id, "balance", ev.target.value)} />
        </label>
        <label>Tasa mensual %
          <input type="number" value={item.rate} onChange={(ev) => onUpdateRate(item.id, ev.target.value)} />
        </label>
      </div>
      <div className="subfields">
        <label>Pago mínimo
          <input type="number" value={item.minPayment} onChange={(ev) => onUpdate(item.id, "minPayment", ev.target.value)} />
        </label>
        <label>N° de cuotas (opcional)
          <input type="number" min="0" placeholder="ej: 12" value={item.totalInstallments}
            onChange={(ev) => onUpdateInstallments(item.id, ev.target.value)} />
        </label>
      </div>
      <div className="subfields">
        <label>Día de pago
          <input type="number" min="1" max="31" placeholder="1-31" value={item.dueDay} onChange={(ev) => onUpdate(item.id, "dueDay", ev.target.value)} />
        </label>
        <label>Plazo límite (opcional)
          <input type="date" value={item.deadlineDate || ""} onChange={(ev) => onUpdate(item.id, "deadlineDate", ev.target.value)} />
        </label>
      </div>
      <div className="deadline-note">
        <input type="text" placeholder="¿Qué pasa si no pagas a tiempo? ej: pierdo 0% de la TC" value={item.deadlineNote || ""}
          onChange={(ev) => onUpdate(item.id, "deadlineNote", ev.target.value)} />
      </div>
      <DebtStatusLine item={item} now={now} />
    </div>
  );
});

/* ------------------------------------------------------------------ */
/* Hoja de estilos                                                     */
/* ------------------------------------------------------------------ */

const AUTH_STYLES = `
  .ledger { --navy:#16213e; --paper:#fbf8f1; --ink:#1c1b1f; --gold:#b8912f; font-family: Georgia, serif; background: var(--navy); color: var(--paper); padding: 40px 18px; max-width: 480px; margin: 0 auto; min-height: 100vh; box-sizing: border-box; }
  .ledger h1 { font-size: 1.4rem; margin: 0 0 8px; }
  .ledger p { font-family: -apple-system, sans-serif; font-size: 0.85rem; color: #c9c2ad; line-height: 1.5; }
  .ledger input { width: 100%; box-sizing: border-box; font-family: -apple-system, sans-serif; font-size: 1rem; padding: 10px; margin: 14px 0; border: 1px solid var(--gold); background: rgba(251,248,241,0.06); color: var(--paper); }
  .ledger input:focus { outline: none; }
  .ledger button { width: 100%; padding: 11px; background: var(--gold); border: none; color: var(--ink); font-weight: 700; font-family: -apple-system, sans-serif; cursor: pointer; }
  .ledger .linkbtn { background: none; color: var(--gold); font-weight: 600; text-decoration: underline; padding: 6px 0; }
`;

const APP_STYLES = `
  .ledger {
    --navy: #16213e; --paper: #fbf8f1; --ink: #1c1b1f; --gold: #b8912f;
    --debt: #a3384a; --free: #3f6b46; --line: #dcd3c0;
    font-family: Georgia, 'Iowan Old Style', serif;
    background: var(--navy); color: var(--paper);
    padding: 20px 14px 32px; max-width: 480px; margin: 0 auto; overflow-x: hidden;
  }
  .ledger * { box-sizing: border-box; }
  .ledger h1 { font-size: 1.5rem; font-weight: 600; letter-spacing: 0.01em; margin: 0 0 2px; }
  .ledger .subtitle { font-family: -apple-system, sans-serif; font-size: 0.8rem; color: #c9c2ad; margin-bottom: 18px; }
  .session-bar { font-family: -apple-system, sans-serif; font-size: 0.72rem; color: #c9c2ad; margin-top: -12px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: center; }
  .ghost-icon-btn, .ghost-text-btn { background: none; border: none; color: var(--gold); cursor: pointer; padding: 0; display: flex; align-items: center; }
  .ghost-text-btn { font-size: 0.72rem; font-weight: 700; }
  .sheet { background: var(--paper); color: var(--ink); border-radius: 2px; padding: 16px 16px 4px; margin-bottom: 14px; }
  .sheet h2 { font-size: 0.95rem; font-weight: 700; margin: 0 0 10px; padding-bottom: 6px; border-bottom: 1.5px solid var(--ink); display: flex; align-items: center; gap: 6px; }
  .legend-dot { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 5px; vertical-align: middle; }
  .snapshot { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px; }
  .stat { background: rgba(251,248,241,0.06); border: 1px solid rgba(251,248,241,0.18); padding: 10px 12px; }
  .stat .label { font-family: -apple-system, sans-serif; font-size: 0.68rem; color: #c9c2ad; text-transform: uppercase; letter-spacing: 0.06em; }
  .stat .value { font-family: 'SFMono-Regular', Consolas, monospace; font-variant-numeric: tabular-nums; font-size: 1.25rem; margin-top: 2px; }
  .stat.free .value { color: #a9d4ab; }
  .stat.debt .value { color: #e79aa6; }
  .row { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 1px solid var(--line); font-family: -apple-system, sans-serif; font-size: 0.85rem; }
  .row input[type="text"] { flex: 1; border: none; background: transparent; font-family: -apple-system, sans-serif; font-size: 0.85rem; color: var(--ink); padding: 4px 0; }
  .row input[type="number"] { width: 92px; border: none; border-bottom: 1px dashed var(--line); background: transparent; font-family: 'SFMono-Regular', Consolas, monospace; font-variant-numeric: tabular-nums; text-align: right; padding: 4px 2px; color: var(--ink); }
  .row input:focus { outline: none; border-color: var(--gold); }
  .row .del { background: none; border: none; color: #9a8f77; cursor: pointer; padding: 4px; }
  .addbtn { display: flex; align-items: center; gap: 6px; background: none; border: none; color: var(--gold); font-family: -apple-system, sans-serif; font-size: 0.82rem; font-weight: 600; padding: 10px 10px 10px 0; cursor: pointer; }
  .addrow { display: flex; flex-wrap: wrap; }
  .type-tag { font-family: -apple-system, sans-serif; font-size: 0.62rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; padding: 2px 6px; border-radius: 2px; }
  .type-tag.fijo { background: rgba(63,107,70,0.12); color: var(--free); }
  .type-tag.deuda { background: rgba(163,56,74,0.12); color: var(--debt); }
  .field { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--line); font-family: -apple-system, sans-serif; font-size: 0.88rem; }
  .field input { width: 110px; border: none; border-bottom: 1px dashed var(--line); background: transparent; font-family: 'SFMono-Regular', Consolas, monospace; text-align: right; font-size: 0.95rem; padding: 4px 2px; }
  .field input:focus { outline: none; border-color: var(--gold); }
  .payday-hint { font-family: -apple-system, sans-serif; font-size: 0.78rem; color: #6b6455; margin-top: 8px; margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
  .methods { display: flex; gap: 8px; margin: 10px 0 12px; }
  .methods button { flex: 1; font-family: -apple-system, sans-serif; font-size: 0.78rem; font-weight: 600; padding: 8px 6px; border: 1.5px solid var(--ink); background: transparent; color: var(--ink); cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 5px; }
  .methods button.active { background: var(--ink); color: var(--paper); }
  .plan-order { font-family: -apple-system, sans-serif; font-size: 0.85rem; margin: 8px 0; padding-left: 18px; }
  .plan-order li { margin-bottom: 4px; }
  .warn { font-family: -apple-system, sans-serif; font-size: 0.85rem; background: rgba(163,56,74,0.1); border-left: 3px solid var(--debt); padding: 10px 12px; margin: 6px 0 12px; color: #7a2536; }
  .plan-summary { font-family: -apple-system, sans-serif; font-size: 0.85rem; line-height: 1.5; padding-bottom: 10px; }
  .plan-summary b { font-family: 'SFMono-Regular', Consolas, monospace; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 4px; }
  .chip { display: flex; align-items: center; gap: 4px; background: rgba(184,145,47,0.12); border: 1px solid var(--gold); color: var(--ink); font-family: 'SFMono-Regular', Consolas, monospace; font-size: 0.78rem; padding: 3px 6px 3px 9px; border-radius: 2px; }
  .chip button { background: none; border: none; color: #9a8f77; cursor: pointer; padding: 2px; display: flex; }
  .payday-grid { display: flex; flex-wrap: wrap; gap: 5px; }
  .payday-day { width: 28px; height: 28px; border: 1.5px solid var(--line); background: #fff; color: var(--ink); font-family: 'SFMono-Regular', Consolas, monospace; font-size: 0.72rem; border-radius: 5px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: background 0.1s, border-color 0.1s; }
  .payday-day:hover { border-color: var(--gold); }
  .payday-day.selected { background: var(--gold); border-color: var(--gold); color: var(--ink); font-weight: 700; }
  .quickadd { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 4px 0 10px; }
  .quickadd input[type="text"] { flex: 1 1 100%; min-width: 0; border: none; border-bottom: 1px dashed var(--line); background: transparent; font-family: -apple-system, sans-serif; font-size: 0.85rem; padding: 5px 2px; color: var(--ink); }
  .quickadd input[type="number"], .quickadd input[type="date"] { flex: 1 1 auto; min-width: 0; border: none; border-bottom: 1px dashed var(--line); background: transparent; font-family: 'SFMono-Regular', Consolas, monospace; text-align: right; font-size: 0.9rem; padding: 5px 2px; color: var(--ink); }
  .quickadd input:focus { outline: none; border-color: var(--gold); }
  .quickadd .go { flex-shrink: 0; background: var(--ink); color: var(--paper); border: none; padding: 7px 9px; cursor: pointer; display: flex; }
  .mini-list { font-family: -apple-system, sans-serif; font-size: 0.82rem; }
  .mini-list .item { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--line); }
  .mini-list .item .amt { font-family: 'SFMono-Regular', Consolas, monospace; font-variant-numeric: tabular-nums; margin-right: 6px; }
  .mini-list .day { color: #9a8f77; font-size: 0.72rem; margin-left: 6px; }
  .mini-list .item input[type="text"] { border: none; border-bottom: 1px dashed transparent; background: transparent; font-family: -apple-system, sans-serif; font-size: 0.82rem; color: var(--ink); padding: 2px 0; min-width: 0; }
  .mini-list .item input[type="text"]:focus { outline: none; border-bottom-color: var(--gold); }
  .mini-list .item .money-input { border: none; border-bottom: 1px dashed transparent; background: transparent; width: 78px; text-align: right; padding: 2px 2px; margin-right: 6px; color: var(--ink); }
  .mini-list .item .money-input:focus { outline: none; border-bottom-color: var(--gold); }
  .mini-edit-fields { display: flex; align-items: center; flex: 1; min-width: 0; margin-right: 8px; }
  .mini-edit-fields input[type="text"] { flex: 1; min-width: 0; }
  .mini-edit-amt { display: flex; align-items: center; }
  .mini-edit-amt .del { padding: 0; }
  .hint { font-family: -apple-system, sans-serif; font-size: 0.8rem; color: #6b6455; margin: 4px 0; }
  .hint-lg { font-family: -apple-system, sans-serif; font-size: 0.85rem; color: #6b6455; }
  .hint-desc { font-family: -apple-system, sans-serif; font-size: 0.74rem; color: #6b6455; margin: 0 0 8px; }
  .plan-action { font-family: -apple-system, sans-serif; font-size: 0.85rem; background: rgba(63,107,70,0.08); border-left: 3px solid var(--free); padding: 10px 12px; margin: 10px 0; }
  .plan-action ul { margin: 6px 0 0; padding-left: 18px; }
  .plan-action li { margin-bottom: 5px; }
  .plan-action b { font-family: 'SFMono-Regular', Consolas, monospace; }
  .debt-card { border-bottom: 1px solid var(--line); padding: 8px 0; margin-bottom: 2px; }
  .debt-card-expanded { border-bottom: 1px solid var(--line); padding-bottom: 6px; margin-bottom: 6px; }
  .debt-card-top { display: flex; align-items: center; gap: 8px; }
  .debt-card-name { flex: 1; font-family: -apple-system, sans-serif; font-size: 0.88rem; font-weight: 600; color: var(--ink); }
  .debt-card-actions { display: flex; gap: 2px; }
  .icon-btn { background: none; border: none; color: #9a8f77; cursor: pointer; padding: 4px; display: flex; align-items: center; }
  .icon-btn:hover { color: var(--ink); }
  .debt-card-numbers { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 4px; padding-left: 2px; }
  .debt-card-balance { font-family: 'SFMono-Regular', Consolas, monospace; font-variant-numeric: tabular-nums; font-size: 1rem; font-weight: 700; color: var(--ink); }
  .chip-mini { font-family: -apple-system, sans-serif; font-size: 0.68rem; font-weight: 600; color: #6b6455; background: rgba(28,27,31,0.06); padding: 2px 7px; border-radius: 10px; }
  .status-line { display: flex; flex-wrap: wrap; gap: 14px; font-family: -apple-system, sans-serif; font-size: 0.72rem; margin-top: 5px; padding-left: 2px; font-weight: 600; }
  .subfields { display: flex; gap: 12px; font-family: -apple-system, sans-serif; font-size: 0.72rem; color: #6b6455; padding-left: 2px; margin-top: 6px; }
  .subfields label { flex: 1; }
  .subfields input { display: block; width: 100%; border: none; border-bottom: 1px dashed var(--line); background: transparent; font-family: 'SFMono-Regular', Consolas, monospace; padding: 3px 0; }
  .subfields input[type="date"] { font-size: 0.7rem; }
  .deadline-note { margin-top: 6px; padding-left: 2px; }
  .deadline-note input { display: block; width: 100%; border: none; border-bottom: 1px dashed var(--line); background: transparent; font-family: -apple-system, sans-serif; font-size: 0.72rem; padding: 3px 0; color: #6b6455; }
  .money-input { font-weight: 700; font-variant-numeric: tabular-nums; }
  .row input.money-input { width: 92px; flex: none; border: none; border-bottom: 1px dashed var(--line); background: transparent; font-family: 'SFMono-Regular', Consolas, monospace; text-align: right; padding: 4px 2px; color: var(--ink); }
  .chart-filter { display: flex; gap: 8px; margin: 0 0 10px; }
  .chart-filter button { flex: 1; font-family: -apple-system, sans-serif; font-size: 0.74rem; font-weight: 600; padding: 6px 4px; border: 1.5px solid var(--ink); background: transparent; color: var(--ink); cursor: pointer; }
  .chart-filter button.active { background: var(--ink); color: var(--paper); }
  .chart-values { font-family: -apple-system, sans-serif; font-size: 0.76rem; margin-top: 10px; max-height: 220px; overflow-y: auto; }
  .chart-value-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; border-bottom: 1px solid var(--line); }
  .chart-value-label { color: #6b6455; font-weight: 600; text-transform: capitalize; }
  .chart-value-nums { display: flex; gap: 10px; font-family: 'SFMono-Regular', Consolas, monospace; font-variant-numeric: tabular-nums; }
`;

/* ------------------------------------------------------------------ */
/* Componente principal                                                */
/* ------------------------------------------------------------------ */

export default function FinanceLedger() {
  const now = useMemo(() => new Date(), []);
  const mKey = monthKey(now);

  const [incomeFixed, setIncomeFixed] = useState(0);
  const [paydays, setPaydays] = useState([15, 30]);
  const [items, setItems] = useState(DEFAULT_ITEMS);
  const [method, setMethod] = useState("avalanche");

  const [extraIncomes, setExtraIncomes] = useState([]);
  const [unexpectedExpenses, setUnexpectedExpenses] = useState([]);

  const [newExtra, setNewExtra] = useState({ desc: "", amount: "" });
  const [newUnexpected, setNewUnexpected] = useState({ desc: "", amount: "" });
  const [expandedDebtIds, setExpandedDebtIds] = useState([]);
  const [paydayPickerOpen, setPaydayPickerOpen] = useState(false);
  const [chartMode, setChartMode] = useState("mes"); // "año" | "mes" | "día"

  const loadedRef = useRef(false);
  const monthsRef = useRef({});
  const [monthsSnapshot, setMonthsSnapshot] = useState({});

  // --- Autenticación con Supabase (email y contraseña) ---
  // La sesión viene de Supabase Auth; los datos de cada usuario se guardan en
  // la tabla "user_data" de Supabase, así se sincronizan entre cualquier
  // dispositivo donde inicie sesión con el mismo correo.
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState("signin"); // "signin" | "signup"
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authMsg, setAuthMsg] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (!newSession) {
        loadedRef.current = false;
        monthsRef.current = {};
      }
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const handleAuthSubmit = useCallback(async () => {
    const email = authEmail.trim();
    if (!email || !authPassword) return;
    setAuthSubmitting(true);
    setAuthError("");
    setAuthMsg("");
    if (authMode === "signup") {
      const { data, error } = await supabase.auth.signUp({ email, password: authPassword });
      if (error) setAuthError(error.message);
      else if (!data.session) setAuthMsg("Cuenta creada. Revisa tu correo para confirmarla antes de entrar.");
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password: authPassword });
      if (error) setAuthError(error.message);
    }
    setAuthSubmitting(false);
  }, [authEmail, authPassword, authMode]);

  const handleSignOut = useCallback(() => supabase.auth.signOut(), []);

  // Carga inicial de datos guardados en Supabase para el usuario autenticado.
  useEffect(() => {
    if (!session) return;

    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("user_data")
        .select("config, months")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (cancelled) return;

      if (error) console.error("No se pudieron cargar tus datos:", error.message);

      const config = (data && data.config) || {};
      const months = (data && data.months) || {};
      monthsRef.current = months;
      setMonthsSnapshot(months);

      if (config.incomeFixed !== undefined) setIncomeFixed(config.incomeFixed);
      if (config.paydays) setPaydays(config.paydays);
      if (config.items) setItems(config.items);
      if (config.method) setMethod(config.method);

      const monthData = months[mKey];
      if (monthData) {
        if (monthData.extraIncomes) setExtraIncomes(monthData.extraIncomes);
        if (monthData.unexpectedExpenses) setUnexpectedExpenses(monthData.unexpectedExpenses);
      }

      loadedRef.current = true;
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const fixedItems = useMemo(() => items.filter((it) => it.type === "fijo"), [items]);
  const debtItems = useMemo(() => items.filter((it) => it.type === "deuda"), [items]);

  const totalExtraIncome = extraIncomes.reduce((s, e) => s + Number(e.amount || 0), 0);
  const totalIncome = Number(incomeFixed) + totalExtraIncome;
  const totalFixedExpenses = fixedItems.reduce((s, e) => s + Number(e.amount || 0), 0);
  const totalExpenses =
    totalFixedExpenses +
    unexpectedExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const totalMinPayments = debtItems.reduce((s, d) => s + Number(d.minPayment || 0), 0);
  const disponible = totalIncome - totalExpenses - totalMinPayments;

  // Guardado con debounce: cada cambio relevante actualiza el snapshot del
  // mes actual y programa un upsert a Supabase.
  useEffect(() => {
    if (!loadedRef.current || !session) return;
    const nextMonths = {
      ...monthsRef.current,
      [mKey]: { extraIncomes, unexpectedExpenses, totalIncome, totalExpenses: totalExpenses + totalMinPayments },
    };
    monthsRef.current = nextMonths;
    setMonthsSnapshot(nextMonths);
    const t = setTimeout(async () => {
      const { error } = await supabase.from("user_data").upsert({
        user_id: session.user.id,
        config: { incomeFixed, paydays, items, method },
        months: nextMonths,
        updated_at: new Date().toISOString(),
      });
      if (error) console.error("No se pudo guardar:", error.message);
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomeFixed, paydays, items, method, extraIncomes, unexpectedExpenses, mKey, session]);

  // Snapshot combinado: todos los meses guardados + el mes en curso con sus
  // totales recién calculados (aún no persistidos).
  const allMonthsMap = useMemo(
    () => ({ ...monthsSnapshot, [mKey]: { totalIncome, totalExpenses: totalExpenses + totalMinPayments } }),
    [monthsSnapshot, mKey, totalIncome, totalExpenses, totalMinPayments]
  );

  const monthlyChartData = useMemo(() => {
    const keys = Object.keys(allMonthsMap).sort((a, b) => {
      const [ay, am] = a.split("-").map(Number);
      const [by, bm] = b.split("-").map(Number);
      return ay * 12 + am - (by * 12 + bm);
    });
    return keys.slice(-12).map((k) => {
      const [, m] = k.split("-").map(Number);
      const entry = allMonthsMap[k] || {};
      return {
        key: k,
        label: MONTH_NAMES[(m - 1 + 12) % 12].slice(0, 3),
        income: Number(entry.totalIncome) || 0,
        expenses: Number(entry.totalExpenses) || 0,
      };
    });
  }, [allMonthsMap]);

  const yearlyChartData = useMemo(() => {
    const byYear = {};
    Object.entries(allMonthsMap).forEach(([k, v]) => {
      const [y] = k.split("-").map(Number);
      if (!byYear[y]) byYear[y] = { income: 0, expenses: 0 };
      byYear[y].income += Number(v.totalIncome) || 0;
      byYear[y].expenses += Number(v.totalExpenses) || 0;
    });
    return Object.keys(byYear)
      .map(Number)
      .sort((a, b) => a - b)
      .map((y) => ({ key: String(y), label: String(y), income: byYear[y].income, expenses: byYear[y].expenses }));
  }, [allMonthsMap]);

  const plan = useMemo(() => {
    if (disponible <= 0) return null;
    return simulateDebtPlan(debtItems, disponible, method);
  }, [debtItems, disponible, method]);

  const activeDebts = useMemo(() => debtItems.filter((d) => Number(d.balance) > 0), [debtItems]);
  const priorityDebt = useMemo(() => {
    if (activeDebts.length === 0) return null;
    return [...activeDebts].sort((a, b) =>
      method === "avalanche" ? Number(b.rate) - Number(a.rate) : Number(a.balance) - Number(b.balance)
    )[0];
  }, [activeDebts, method]);

  const sortedPaydays = useMemo(
    () => [...paydays].map(Number).filter((n) => n >= 1 && n <= 31).sort((a, b) => a - b),
    [paydays]
  );
  const perPaydayFixedAndMin =
    sortedPaydays.length > 0
      ? (totalFixedExpenses + totalMinPayments) / sortedPaydays.length
      : totalFixedExpenses + totalMinPayments;
  const lastPayday = sortedPaydays[sortedPaydays.length - 1];

  // Vista por día: solo existe detalle con fecha para el mes en curso
  // (ingresos extra, gastos inesperados, sueldo repartido en días de pago
  // y deudas/cuotas con día de pago fijo).
  const dailyChartData = useMemo(() => {
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const incomeByDay = {};
    const expenseByDay = {};
    extraIncomes.forEach((x) => {
      incomeByDay[x.day] = (incomeByDay[x.day] || 0) + Number(x.amount || 0);
    });
    unexpectedExpenses.forEach((x) => {
      expenseByDay[x.day] = (expenseByDay[x.day] || 0) + Number(x.amount || 0);
    });
    if (sortedPaydays.length > 0 && Number(incomeFixed) > 0) {
      const perPayday = Number(incomeFixed) / sortedPaydays.length;
      sortedPaydays.forEach((p) => {
        if (p <= daysInMonth) incomeByDay[p] = (incomeByDay[p] || 0) + perPayday;
      });
    }
    debtItems.forEach((d) => {
      const day = Number(d.dueDay);
      if (day >= 1 && day <= daysInMonth && Number(d.minPayment) > 0) {
        expenseByDay[day] = (expenseByDay[day] || 0) + Number(d.minPayment);
      }
    });
    const out = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const income = incomeByDay[day] || 0;
      const expenses = expenseByDay[day] || 0;
      if (income > 0 || expenses > 0) out.push({ key: `d${day}`, label: String(day), income, expenses });
    }
    return out;
  }, [extraIncomes, unexpectedExpenses, sortedPaydays, incomeFixed, debtItems, now]);

  const chartData = chartMode === "año" ? yearlyChartData : chartMode === "día" ? dailyChartData : monthlyChartData;

  const updateItem = useCallback(
    (id, field, val) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, [field]: val } : x))),
    []
  );

  const updateInstallments = useCallback((id, val) => {
    setItems((xs) =>
      xs.map((x) => {
        if (x.id !== id) return x;
        const next = { ...x, totalInstallments: val };
        const balance = Number(x.balance);
        if (balance > 0 && !Number(x.minPayment)) {
          const suggested = suggestMinPayment(balance, x.rate, val);
          if (suggested) next.minPayment = suggested;
        }
        return next;
      })
    );
  }, []);

  // Sugiere el pago mínimo según el tipo de deuda. Si tiene un número de
  // cuotas definido (compra a cuotas fijas), usa la fórmula de cuota fija
  // que cobran los bancos (amortización): saldo × tasa / (1 − (1+tasa)^−n).
  // Si no tiene cuotas (deuda revolvente tipo tarjeta sin plazo fijo), usa
  // interés del mes + 2% del saldo. Solo autocompleta si el campo de pago
  // mínimo está vacío.
  const updateRate = useCallback((id, val) => {
    setItems((xs) =>
      xs.map((x) => {
        if (x.id !== id) return x;
        const next = { ...x, rate: val };
        const balance = Number(x.balance);
        if (balance > 0 && !Number(x.minPayment)) {
          const suggested = suggestMinPayment(balance, val, x.totalInstallments);
          if (suggested) next.minPayment = suggested;
        }
        return next;
      })
    );
  }, []);

  const addFijo = useCallback(
    () => setItems((xs) => [...xs, { id: uid(), type: "fijo", name: "Nuevo gasto", amount: 0 }]),
    []
  );

  const addDeuda = useCallback(() => {
    const id = uid();
    setItems((xs) => [
      ...xs,
      { id, type: "deuda", name: "Nueva deuda o compra", balance: 0, rate: 0, minPayment: 0, totalInstallments: "", dueDay: "", deadlineDate: "", deadlineNote: "" },
    ]);
    setExpandedDebtIds((xs) => [...xs, id]);
  }, []);

  const removeItem = useCallback((id) => {
    setItems((xs) => xs.filter((x) => x.id !== id));
    setExpandedDebtIds((xs) => xs.filter((x) => x !== id));
  }, []);

  const toggleDebtExpanded = useCallback(
    (id) => setExpandedDebtIds((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id])),
    []
  );

  const togglePayday = useCallback(
    (n) => setPaydays((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n].sort((a, b) => a - b))),
    []
  );

  const addExtraIncome = useCallback(() => {
    if (!newExtra.amount) return;
    setExtraIncomes((xs) => [...xs, { id: uid(), desc: newExtra.desc || "Ingreso extra", amount: newExtra.amount, day: now.getDate() }]);
    setNewExtra({ desc: "", amount: "" });
  }, [newExtra, now]);

  const addUnexpectedExpense = useCallback(() => {
    if (!newUnexpected.amount) return;
    setUnexpectedExpenses((xs) => [...xs, { id: uid(), desc: newUnexpected.desc || "Gasto inesperado", amount: newUnexpected.amount, day: now.getDate() }]);
    setNewUnexpected({ desc: "", amount: "" });
  }, [newUnexpected, now]);

  const updateExtraIncome = useCallback(
    (id, field, val) => setExtraIncomes((xs) => xs.map((x) => (x.id === id ? { ...x, [field]: val } : x))),
    []
  );
  const removeExtraIncome = useCallback((id) => setExtraIncomes((xs) => xs.filter((x) => x.id !== id)), []);

  const updateUnexpectedExpense = useCallback(
    (id, field, val) => setUnexpectedExpenses((xs) => xs.map((x) => (x.id === id ? { ...x, [field]: val } : x))),
    []
  );
  const removeUnexpectedExpense = useCallback((id) => setUnexpectedExpenses((xs) => xs.filter((x) => x.id !== id)), []);

  if (authLoading) {
    return <div style={{ background: "#16213e", minHeight: 100 }} />;
  }

  if (!session) {
    return (
      <AuthScreen
        mode={authMode}
        email={authEmail}
        password={authPassword}
        error={authError}
        msg={authMsg}
        submitting={authSubmitting}
        onEmailChange={setAuthEmail}
        onPasswordChange={setAuthPassword}
        onSubmit={handleAuthSubmit}
        onToggleMode={() => {
          setAuthMode((m) => (m === "signup" ? "signin" : "signup"));
          setAuthError("");
          setAuthMsg("");
        }}
      />
    );
  }

  return (
    <div className="ledger">
      <style>{APP_STYLES}</style>

      <h1>Panel financiero</h1>
      <div className="subtitle">Ingreso, gastos, deudas, ahorro y plan de pago — mes actual</div>
      <Header email={session.user.email} onRefresh={() => window.location.reload()} onSignOut={handleSignOut} />

      <StatsSnapshot
        totalIncome={totalIncome}
        totalExpenses={totalExpenses}
        totalMinPayments={totalMinPayments}
        disponible={disponible}
      />

      <div className="sheet">
        <h2>Ingresos y gastos</h2>
        <div className="chart-filter">
          <button className={chartMode === "año" ? "active" : ""} onClick={() => setChartMode("año")}>Año</button>
          <button className={chartMode === "mes" ? "active" : ""} onClick={() => setChartMode("mes")}>Mes</button>
          <button className={chartMode === "día" ? "active" : ""} onClick={() => setChartMode("día")}>Día</button>
        </div>
        {chartData.length > 0 ? (
          <>
            <MonthlyChart data={chartData} />
            <ChartLegend />
            <div className="chart-values">
              {chartData.map((d) => (
                <div className="chart-value-row" key={d.key}>
                  <span className="chart-value-label">{chartMode === "día" ? `Día ${d.label}` : d.label}</span>
                  <span className="chart-value-nums">
                    <span style={{ color: "var(--free)" }}>+${fmt(d.income)}</span>
                    <span style={{ color: "var(--debt)" }}>-${fmt(d.expenses)}</span>
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="hint">
            {chartMode === "día"
              ? "Sin movimientos con fecha registrados este mes (ingresos extra, gastos inesperados, días de pago o vencimientos de deudas)."
              : "Aún no hay datos suficientes para mostrar el gráfico."}
          </p>
        )}
      </div>

      <div className="sheet">
        <h2>Ingreso fijo</h2>
        <div className="field">
          <span>Sueldo fijo mensual</span>
          <MoneyInput value={incomeFixed} onChange={setIncomeFixed} />
        </div>
        <div className="payday-hint"><CalendarDays size={13} />Días de pago</div>
        <div className="chips" style={{ marginBottom: 8 }}>
          {paydays.length === 0 && !paydayPickerOpen && (
            <span style={{ fontFamily: "-apple-system, sans-serif", fontSize: "0.78rem", color: "#9a8f77" }}>Ninguno marcado todavía.</span>
          )}
          {sortedPaydays.map((p) => (
            <span className="chip" key={p}>Día {p}<button onClick={() => togglePayday(p)}><X size={12} /></button></span>
          ))}
          <button
            onClick={() => setPaydayPickerOpen((o) => !o)}
            style={{ background: "none", border: "1px dashed var(--gold)", color: "var(--gold)", fontFamily: "-apple-system, sans-serif", fontSize: "0.76rem", fontWeight: 600, padding: "3px 9px", cursor: "pointer", borderRadius: 2 }}
          >
            {paydayPickerOpen ? "Listo" : "+ Editar días"}
          </button>
        </div>
        {paydayPickerOpen && (
          <div className="payday-grid" style={{ marginBottom: 10 }}>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <button
                key={d}
                className={`payday-day${paydays.includes(d) ? " selected" : ""}`}
                onClick={() => togglePayday(d)}
                type="button"
              >
                {d}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="sheet">
        <h2>Ingresos extra — {MONTH_NAMES[now.getMonth()]}</h2>
        <div className="quickadd">
          <input type="text" placeholder="¿De qué fue?" value={newExtra.desc} onChange={(e) => setNewExtra((v) => ({ ...v, desc: e.target.value }))} />
          <input type="number" placeholder="Monto" value={newExtra.amount} onChange={(e) => setNewExtra((v) => ({ ...v, amount: e.target.value }))} />
          <button className="go" onClick={addExtraIncome}><Plus size={15} /></button>
        </div>
        {extraIncomes.length > 0 ? (
          <div className="mini-list">
            {extraIncomes.map((x) => (
              <MiniListItem key={x.id} x={x} onUpdate={updateExtraIncome} onRemove={removeExtraIncome} />
            ))}
            <div className="item" style={{ borderBottom: "none", fontWeight: 700 }}>
              <span>{extraIncomes.length} ingreso{extraIncomes.length === 1 ? "" : "s"} extra este mes</span>
              <span className="amt">${fmt(totalExtraIncome)}</span>
            </div>
          </div>
        ) : (
          <p className="hint">Aún no registras ingresos extra este mes.</p>
        )}
      </div>

      <div className="sheet">
        <h2><Zap size={14} />Gasto inesperado — {MONTH_NAMES[now.getMonth()]}</h2>
        <div className="quickadd">
          <input type="text" placeholder="¿En qué gastaste?" value={newUnexpected.desc} onChange={(e) => setNewUnexpected((v) => ({ ...v, desc: e.target.value }))} />
          <input type="number" placeholder="Monto" value={newUnexpected.amount} onChange={(e) => setNewUnexpected((v) => ({ ...v, amount: e.target.value }))} />
          <button className="go" onClick={addUnexpectedExpense}><Plus size={15} /></button>
        </div>
        {unexpectedExpenses.length > 0 ? (
          <div className="mini-list">
            {unexpectedExpenses.map((x) => (
              <MiniListItem key={x.id} x={x} onUpdate={updateUnexpectedExpense} onRemove={removeUnexpectedExpense} />
            ))}
            <div className="item" style={{ borderBottom: "none", fontWeight: 700 }}>
              <span>Total inesperados este mes</span>
              <span className="amt">${fmt(unexpectedExpenses.reduce((s, e) => s + Number(e.amount || 0), 0))}</span>
            </div>
          </div>
        ) : (
          <p className="hint">Sin gastos inesperados registrados este mes.</p>
        )}
      </div>

      <div className="sheet">
        <h2>Gastos y deudas</h2>
        <p className="hint-desc">
          Todo en un solo lugar: lo fijo sin fecha de fin, y lo que tiene saldo — deudas, tarjeta de crédito, compras a cuotas
          o incluso una meta de ahorro (agrégala como deuda con tasa 0% y la fecha en que la quieres cumplida).
        </p>
        {items.map((it) =>
          it.type === "fijo" ? (
            <FixedExpenseRow key={it.id} item={it} onUpdate={updateItem} onRemove={removeItem} />
          ) : (
            <DebtItem
              key={it.id}
              item={it}
              now={now}
              expanded={expandedDebtIds.includes(it.id)}
              onToggleExpand={toggleDebtExpanded}
              onRemove={removeItem}
              onUpdate={updateItem}
              onUpdateInstallments={updateInstallments}
              onUpdateRate={updateRate}
            />
          )
        )}
        <div className="addrow">
          <button className="addbtn" onClick={addFijo}><Plus size={14} /> Gasto fijo</button>
          <button className="addbtn" onClick={addDeuda}><Plus size={14} /> Deuda o compra a cuotas</button>
        </div>
      </div>

      <div className="sheet">
        <h2>Plan de pago</h2>
        <p className="hint-desc">Elige cómo priorizar tu dinero extra entre deudas, compras a cuotas y metas de ahorro:</p>
        <div className="methods">
          <button className={method === "avalanche" ? "active" : ""} onClick={() => setMethod("avalanche")}><ArrowDownWideNarrow size={14} /> Avalancha (mayor tasa)</button>
          <button className={method === "snowball" ? "active" : ""} onClick={() => setMethod("snowball")}><Flame size={14} /> Bola de nieve (menor saldo)</button>
        </div>

        {(() => {
          const deadlines = debtItems.filter((d) => d.deadlineDate).map((d) => ({ ...d, days: daysUntilDate(d.deadlineDate, now) })).sort((a, b) => a.days - b.days);
          if (deadlines.length === 0) return null;
          return (
            <div className="warn" style={{ background: "rgba(184,145,47,0.12)", borderLeftColor: "var(--gold)", color: "#6b5215" }}>
              <b>Plazos importantes:</b>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {deadlines.map((d) => (
                  <li key={d.id}><b>{d.name}</b>: {d.days < 0 ? "plazo ya vencido" : d.days === 0 ? "¡vence hoy!" : `faltan ${d.days} día${d.days === 1 ? "" : "s"}`}{d.deadlineNote ? ` — ${d.deadlineNote}` : ""}</li>
                ))}
              </ul>
            </div>
          );
        })()}

        {disponible <= 0 ? (
          <div className="warn">
            Tus gastos y pagos mínimos (${fmt(totalExpenses + totalMinPayments)}) superan o igualan tu ingreso (${fmt(totalIncome)}).
            No hay dinero extra para acelerar el pago de deudas y compras a cuotas — ajusta gastos o aumenta ingreso antes de planear.
          </div>
        ) : plan && plan.order.length > 0 ? (
          <div className="plan-summary">
            {sortedPaydays.length > 0 && priorityDebt ? (
              <div className="plan-action">
                Así reparte tu dinero para gastos fijos, deudas y compras a cuotas cada mes:
                <ul>
                  {sortedPaydays.map((p) => (
                    <li key={p}>
                      <b>Día {p}</b>: separa <b>${fmt(perPaydayFixedAndMin)}</b> para gastos fijos y pagos mínimos
                      {p === lastPayday && disponible > 0 && (
                        <> + <b>${fmt(disponible)}</b> extra hacia <b>{priorityDebt.name}</b> (tu prioridad con {method === "avalanche" ? "la tasa más alta" : "el saldo más bajo"})</>
                      )}.
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p style={{ color: "#6b6455" }}>Agrega tus días de pago arriba para un plan de acción día a día.</p>
            )}
            Orden en que quedarán liquidadas:
            <ol className="plan-order">
              {plan.order.map((o, i) => (<li key={i}>{o.name} — liquidada en el mes {o.month}</li>))}
            </ol>
            {plan.unsustainable ? (
              <div className="warn">Con el extra actual, algunas no se liquidan en 50 años: la tasa de interés supera lo que alcanzas a pagar.</div>
            ) : (
              <>Quedarás libre de deudas y cuotas en aproximadamente <b>{plan.months}</b> meses, pagando un total estimado de <b>${fmt(plan.totalInterest)}</b> en intereses.</>
            )}
          </div>
        ) : (
          <p className="hint-lg">Agrega al menos una deuda, compra a cuotas o meta de ahorro con saldo mayor a cero para ver el plan.</p>
        )}
      </div>
    </div>
  );
}
