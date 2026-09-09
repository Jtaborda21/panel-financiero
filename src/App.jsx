import React, { useState, useMemo, useEffect, useRef } from "react";
import { Plus, Trash2, ArrowDownWideNarrow, Flame, CalendarDays, Zap, X, PiggyBank, Pencil, ChevronDown, RefreshCw } from "lucide-react";
import { supabase } from "./supabaseClient";

const uid = () => Math.random().toString(36).slice(2, 9);

const DEFAULT_ITEMS = [
  { id: uid(), type: "fijo", name: "Arriendo / vivienda", amount: 0 },
  { id: uid(), type: "fijo", name: "Comida", amount: 0 },
  { id: uid(), type: "fijo", name: "Transporte", amount: 0 },
  { id: uid(), type: "fijo", name: "Universidad (matrícula, materiales)", amount: 0 },
  { id: uid(), type: "fijo", name: "Servicios y celular", amount: 0 },
  { id: uid(), type: "deuda", name: "Deuda 1", balance: 0, rate: 0, minPayment: 0, totalInstallments: "", dueDay: "", deadlineDate: "", deadlineNote: "" },
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

// Cuenta cuántos días de pago (ej: día 4 de cada mes) caen entre hoy y una fecha objetivo.
// Así una meta no cuenta un sueldo que en realidad llega después de la fecha límite.
function countPaydaysUntil(targetDateStr, paydays, today) {
  if (!targetDateStr || !paydays || paydays.length === 0) return null;
  const target = new Date(targetDateStr + "T00:00:00");
  if (Number.isNaN(target.getTime())) return null;
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (target <= todayMid) return 0;
  let count = 0;
  let cursor = new Date(todayMid.getFullYear(), todayMid.getMonth(), 1);
  let guard = 0;
  while (cursor <= target && guard < 600) {
    guard++;
    paydays.forEach((p) => {
      const day = Number(p);
      const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
      const actualDay = Math.min(day, daysInMonth);
      const payDate = new Date(cursor.getFullYear(), cursor.getMonth(), actualDay);
      if (payDate > todayMid && payDate <= target) count++;
    });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return count;
}

function fmt(n) {
  const v = Number.isFinite(n) ? n : 0;
  return v.toLocaleString("es-CO", { maximumFractionDigits: 0 });
}

function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${d.getMonth() + 1}`;
}

const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

// Gráfico sencillo de barras: ingresos vs gastos mes a mes
function MonthlyChart({ data }) {
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
}

// Simulación mensual del plan de pago (avalancha o bola de nieve)
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
      const interest = d.balance * (d.rate / 100 / 12);
      d.balance += interest;
      totalInterest += interest;
    });

    active.sort((a, b) =>
      method === "avalanche" ? b.rate - a.rate : a.balance - b.balance
    );

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

  return {
    months,
    totalInterest,
    order: payoffOrder,
    unsustainable: active.length > 0,
  };
}

export default function FinanceLedger() {
  const now = useMemo(() => new Date(), []);
  const mKey = monthKey(now);

  const [incomeFixed, setIncomeFixed] = useState(0);
  const [paydays, setPaydays] = useState([15, 30]);
  const [items, setItems] = useState(DEFAULT_ITEMS);
  const [method, setMethod] = useState("avalanche");
  const [savingsGoals, setSavingsGoals] = useState([]);

  const [extraIncomes, setExtraIncomes] = useState([]);
  const [unexpectedExpenses, setUnexpectedExpenses] = useState([]);

  const [newExtra, setNewExtra] = useState({ desc: "", amount: "" });
  const [newUnexpected, setNewUnexpected] = useState({ desc: "", amount: "" });
  const [newGoal, setNewGoal] = useState({ name: "", targetAmount: "", targetDate: "" });
  const [expandedDebtIds, setExpandedDebtIds] = useState([]);

  const loadedRef = useRef(false);
  const [loaded, setLoaded] = useState(false);
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
        setLoaded(false);
        monthsRef.current = {};
      }
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const handleAuthSubmit = async () => {
    const email = authEmail.trim();
    if (!email || !authPassword) return;
    setAuthSubmitting(true);
    setAuthError("");
    setAuthMsg("");
    if (authMode === "signup") {
      const { data, error } = await supabase.auth.signUp({ email, password: authPassword });
      if (error) {
        setAuthError(error.message);
      } else if (!data.session) {
        setAuthMsg("Cuenta creada. Revisa tu correo para confirmarla antes de entrar.");
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password: authPassword });
      if (error) setAuthError(error.message);
    }
    setAuthSubmitting(false);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

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

      if (error) {
        console.error("No se pudieron cargar tus datos:", error.message);
      }

      const config = (data && data.config) || {};
      const months = (data && data.months) || {};
      monthsRef.current = months;
      setMonthsSnapshot(months);

      if (config.incomeFixed !== undefined) setIncomeFixed(config.incomeFixed);
      if (config.paydays) setPaydays(config.paydays);
      if (config.items) setItems(config.items);
      if (config.savingsGoals) setSavingsGoals(config.savingsGoals);
      if (config.method) setMethod(config.method);

      const monthData = months[mKey];
      if (monthData) {
        if (monthData.extraIncomes) setExtraIncomes(monthData.extraIncomes);
        if (monthData.unexpectedExpenses) setUnexpectedExpenses(monthData.unexpectedExpenses);
      }

      loadedRef.current = true;
      setLoaded(true);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

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
        config: { incomeFixed, paydays, items, savingsGoals, method },
        months: nextMonths,
        updated_at: new Date().toISOString(),
      });
      if (error) console.error("No se pudo guardar:", error.message);
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomeFixed, paydays, items, savingsGoals, method, extraIncomes, unexpectedExpenses, mKey, session]);

  const fixedItems = items.filter((it) => it.type === "fijo");
  const debtItems = items.filter((it) => it.type === "deuda");

  const totalExtraIncome = extraIncomes.reduce((s, e) => s + Number(e.amount || 0), 0);
  const totalIncome = Number(incomeFixed) + totalExtraIncome;
  const totalExpenses =
    fixedItems.reduce((s, e) => s + Number(e.amount || 0), 0) +
    unexpectedExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const totalMinPayments = debtItems.reduce((s, d) => s + Number(d.minPayment || 0), 0);
  const disponible = totalIncome - totalExpenses - totalMinPayments;

  const monthlyChartData = useMemo(() => {
    const map = { ...monthsSnapshot, [mKey]: { totalIncome, totalExpenses: totalExpenses + totalMinPayments } };
    const keys = Object.keys(map).sort((a, b) => {
      const [ay, am] = a.split("-").map(Number);
      const [by, bm] = b.split("-").map(Number);
      return ay * 12 + am - (by * 12 + bm);
    });
    return keys.slice(-6).map((k) => {
      const [, m] = k.split("-").map(Number);
      const entry = map[k] || {};
      return {
        key: k,
        label: MONTH_NAMES[(m - 1 + 12) % 12].slice(0, 3),
        income: Number(entry.totalIncome) || 0,
        expenses: Number(entry.totalExpenses) || 0,
      };
    });
  }, [monthsSnapshot, mKey, totalIncome, totalExpenses, totalMinPayments]);

  const plan = useMemo(() => {
    if (disponible <= 0) return null;
    return simulateDebtPlan(debtItems, disponible, method);
  }, [debtItems, disponible, method]);

  const activeDebts = debtItems.filter((d) => Number(d.balance) > 0);
  const priorityDebt = useMemo(() => {
    if (activeDebts.length === 0) return null;
    return [...activeDebts].sort((a, b) =>
      method === "avalanche" ? Number(b.rate) - Number(a.rate) : Number(a.balance) - Number(b.balance)
    )[0];
  }, [activeDebts, method]);

  const highestRateDebt = useMemo(() => {
    if (activeDebts.length === 0) return null;
    return [...activeDebts].sort((a, b) => Number(b.rate) - Number(a.rate))[0];
  }, [activeDebts]);

  const sortedPaydays = [...paydays].map(Number).filter((n) => n >= 1 && n <= 31).sort((a, b) => a - b);
  const perPaydayMin = sortedPaydays.length > 0 ? totalMinPayments / sortedPaydays.length : totalMinPayments;
  const lastPayday = sortedPaydays[sortedPaydays.length - 1];

  const updateItem = (id, field, val) =>
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, [field]: val } : x)));

  const updateInstallments = (id, val) => {
    setItems((xs) =>
      xs.map((x) => {
        if (x.id !== id) return x;
        const next = { ...x, totalInstallments: val };
        const cuotas = Number(val);
        if (cuotas > 0 && Number(x.balance) > 0 && !Number(x.minPayment)) {
          next.minPayment = Math.round(Number(x.balance) / cuotas);
        }
        return next;
      })
    );
  };

  const addFijo = () => setItems((xs) => [...xs, { id: uid(), type: "fijo", name: "Nuevo gasto", amount: 0 }]);
  const addDeuda = () => {
    const id = uid();
    setItems((xs) => [
      ...xs,
      { id, type: "deuda", name: "Nueva deuda o compra", balance: 0, rate: 0, minPayment: 0, totalInstallments: "", dueDay: "", deadlineDate: "", deadlineNote: "" },
    ]);
    setExpandedDebtIds((xs) => [...xs, id]);
  };
  const removeItem = (id) => {
    setItems((xs) => xs.filter((x) => x.id !== id));
    setExpandedDebtIds((xs) => xs.filter((x) => x !== id));
  };
  const toggleDebtExpanded = (id) =>
    setExpandedDebtIds((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));

  const [paydayPickerOpen, setPaydayPickerOpen] = useState(false);
  const togglePayday = (n) =>
    setPaydays((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n].sort((a, b) => a - b)));

  const addExtraIncome = () => {
    if (!newExtra.amount) return;
    setExtraIncomes((xs) => [...xs, { id: uid(), desc: newExtra.desc || "Ingreso extra", amount: newExtra.amount, day: now.getDate() }]);
    setNewExtra({ desc: "", amount: "" });
  };

  const addUnexpectedExpense = () => {
    if (!newUnexpected.amount) return;
    setUnexpectedExpenses((xs) => [...xs, { id: uid(), desc: newUnexpected.desc || "Gasto inesperado", amount: newUnexpected.amount, day: now.getDate() }]);
    setNewUnexpected({ desc: "", amount: "" });
  };

  const updateGoal = (id, field, val) =>
    setSavingsGoals((gs) => gs.map((g) => (g.id === id ? { ...g, [field]: val } : g)));
  const removeGoal = (id) => setSavingsGoals((gs) => gs.filter((g) => g.id !== id));
  const addGoal = () => {
    if (!newGoal.name.trim() || !newGoal.targetAmount) return;
    setSavingsGoals((gs) => [...gs, { id: uid(), name: newGoal.name, savedAmount: 0, targetAmount: newGoal.targetAmount, targetDate: newGoal.targetDate }]);
    setNewGoal({ name: "", targetAmount: "", targetDate: "" });
  };

  // Cálculo de metas de ahorro: cuánto falta ahorrar por mes para cada una
  const goalsCalc = savingsGoals.map((g) => {
    const remaining = Number(g.targetAmount || 0) - Number(g.savedAmount || 0);
    const daysLeft = daysUntilDate(g.targetDate, now);
    const paydaysLeft = countPaydaysUntil(g.targetDate, sortedPaydays, now);
    const requiredPerPayday = remaining > 0 && paydaysLeft > 0 ? remaining / paydaysLeft : 0;
    // equivalente mensual aproximado, solo para comparar contra el disponible general
    const requiredMonthly = requiredPerPayday * (sortedPaydays.length || 1);
    return { ...g, remaining, daysLeft, paydaysLeft, requiredPerPayday, requiredMonthly };
  });
  const totalRequiredMonthly = goalsCalc.reduce((s, g) => s + (g.remaining > 0 ? g.requiredMonthly : 0), 0);

  if (authLoading) {
    return <div style={{ background: "#16213e", minHeight: 100 }} />;
  }

  if (!session) {
    return (
      <div className="ledger">
        <style>{`
          .ledger { --navy:#16213e; --paper:#fbf8f1; --ink:#1c1b1f; --gold:#b8912f; font-family: Georgia, serif; background: var(--navy); color: var(--paper); padding: 40px 18px; max-width: 480px; margin: 0 auto; min-height: 100vh; box-sizing: border-box; }
          .ledger h1 { font-size: 1.4rem; margin: 0 0 8px; }
          .ledger p { font-family: -apple-system, sans-serif; font-size: 0.85rem; color: #c9c2ad; line-height: 1.5; }
          .ledger input { width: 100%; box-sizing: border-box; font-family: -apple-system, sans-serif; font-size: 1rem; padding: 10px; margin: 14px 0; border: 1px solid var(--gold); background: rgba(251,248,241,0.06); color: var(--paper); }
          .ledger input:focus { outline: none; }
          .ledger button { width: 100%; padding: 11px; background: var(--gold); border: none; color: var(--ink); font-weight: 700; font-family: -apple-system, sans-serif; cursor: pointer; }
          .ledger .linkbtn { background: none; color: var(--gold); font-weight: 600; text-decoration: underline; padding: 6px 0; }
        `}</style>
        <h1>Panel financiero</h1>
        <p>
          {authMode === "signup"
            ? "Crea una cuenta para guardar tus datos y verlos desde cualquier dispositivo iniciando sesión con el mismo correo."
            : "Inicia sesión con tu correo y contraseña para ver tus datos."}
        </p>
        {authError && <p style={{ color: "#e79aa6" }}>{authError}</p>}
        {authMsg && <p style={{ color: "#a9d4ab" }}>{authMsg}</p>}
        <input type="email" placeholder="Correo" value={authEmail}
          onChange={(e) => setAuthEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleAuthSubmit()} />
        <input type="password" placeholder="Contraseña" value={authPassword}
          onChange={(e) => setAuthPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleAuthSubmit()} />
        <button onClick={handleAuthSubmit} disabled={authSubmitting}>
          {authSubmitting ? "..." : authMode === "signup" ? "Crear cuenta" : "Entrar"}
        </button>
        <button
          className="linkbtn"
          onClick={() => {
            setAuthMode((m) => (m === "signup" ? "signin" : "signup"));
            setAuthError("");
            setAuthMsg("");
          }}
        >
          {authMode === "signup" ? "Ya tengo cuenta" : "Crear una cuenta nueva"}
        </button>
      </div>
    );
  }

  return (
    <div className="ledger">
      <style>{`
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
        .sheet { background: var(--paper); color: var(--ink); border-radius: 2px; padding: 16px 16px 4px; margin-bottom: 14px; }
        .sheet h2 { font-size: 0.95rem; font-weight: 700; margin: 0 0 10px; padding-bottom: 6px; border-bottom: 1.5px solid var(--ink); display: flex; align-items: center; gap: 6px; }
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
        .plan-action { font-family: -apple-system, sans-serif; font-size: 0.85rem; background: rgba(63,107,70,0.08); border-left: 3px solid var(--free); padding: 10px 12px; margin: 10px 0; }
        .plan-action ul { margin: 6px 0 0; padding-left: 18px; }
        .plan-action li { margin-bottom: 5px; }
        .plan-action b { font-family: 'SFMono-Regular', Consolas, monospace; }
        .goal-card { border-bottom: 1px solid var(--line); padding-bottom: 8px; margin-bottom: 8px; }
        .goal-fields { display: flex; gap: 10px; font-family: -apple-system, sans-serif; font-size: 0.72rem; color: #6b6455; padding-left: 2px; margin-top: 4px; }
        .goal-fields label { flex: 1; }
        .goal-fields input { display: block; width: 100%; border: none; border-bottom: 1px dashed var(--line); background: transparent; font-family: 'SFMono-Regular', Consolas, monospace; padding: 3px 0; }
        .goal-progress { font-family: -apple-system, sans-serif; font-size: 0.72rem; margin-top: 6px; font-weight: 600; }
        .disclaimer { font-family: -apple-system, sans-serif; font-size: 0.68rem; color: #9a8f77; margin-top: 8px; font-style: italic; }
        .debt-card { border-bottom: 1px solid var(--line); padding: 8px 0; margin-bottom: 2px; }
        .debt-card-top { display: flex; align-items: center; gap: 8px; }
        .debt-card-name { flex: 1; font-family: -apple-system, sans-serif; font-size: 0.88rem; font-weight: 600; color: var(--ink); }
        .debt-card-actions { display: flex; gap: 2px; }
        .icon-btn { background: none; border: none; color: #9a8f77; cursor: pointer; padding: 4px; display: flex; align-items: center; }
        .icon-btn:hover { color: var(--ink); }
        .debt-card-numbers { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 4px; padding-left: 2px; }
        .debt-card-balance { font-family: 'SFMono-Regular', Consolas, monospace; font-variant-numeric: tabular-nums; font-size: 1rem; font-weight: 700; color: var(--ink); }
        .chip-mini { font-family: -apple-system, sans-serif; font-size: 0.68rem; font-weight: 600; color: #6b6455; background: rgba(28,27,31,0.06); padding: 2px 7px; border-radius: 10px; }
      `}</style>

      <h1>Panel financiero</h1>
      <div className="subtitle">Ingreso, gastos, deudas, ahorro y plan de pago — mes actual</div>
      <div style={{ fontFamily: "-apple-system, sans-serif", fontSize: "0.72rem", color: "#c9c2ad", marginTop: -12, marginBottom: 18, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Sesión: <b style={{ color: "#e0d9c4" }}>{session.user.email}</b></span>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => window.location.reload()} title="Refrescar" style={{ background: "none", border: "none", color: "var(--gold)", display: "flex", alignItems: "center", cursor: "pointer", padding: 0 }}>
            <RefreshCw size={14} />
          </button>
          <button onClick={handleSignOut} style={{ background: "none", border: "none", color: "var(--gold)", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer", padding: 0 }}>cerrar sesión</button>
        </div>
      </div>

      <div className="snapshot">
        <div className="stat"><div className="label">Ingreso total</div><div className="value">${fmt(totalIncome)}</div></div>
        <div className="stat"><div className="label">Gastos fijos</div><div className="value">${fmt(totalExpenses)}</div></div>
        <div className="stat"><div className="label">Pago mínimo deudas</div><div className="value">${fmt(totalMinPayments)}</div></div>
        <div className={`stat ${disponible >= 0 ? "free" : "debt"}`}>
          <div className="label">{disponible >= 0 ? "Disponible extra" : "Déficit"}</div>
          <div className="value">${fmt(Math.abs(disponible))}</div>
        </div>
      </div>

      <div className="sheet">
        <h2>Ingresos y gastos por mes</h2>
        <MonthlyChart data={monthlyChartData} />
        <div style={{ display: "flex", gap: 14, marginTop: 6, fontFamily: "-apple-system, sans-serif", fontSize: "0.72rem", color: "#6b6455" }}>
          <span><span style={{ display: "inline-block", width: 9, height: 9, background: "var(--free)", borderRadius: 2, marginRight: 5, verticalAlign: "middle" }} />Ingresos</span>
          <span><span style={{ display: "inline-block", width: 9, height: 9, background: "var(--debt)", borderRadius: 2, marginRight: 5, verticalAlign: "middle" }} />Gastos</span>
        </div>
      </div>

      <div className="sheet">
        <h2>Ingreso fijo</h2>
        <div className="field">
          <span>Sueldo fijo mensual</span>
          <input type="number" value={incomeFixed} onChange={(e) => setIncomeFixed(e.target.value)} />
        </div>
        <div style={{ fontFamily: "-apple-system, sans-serif", fontSize: "0.78rem", color: "#6b6455", marginTop: 8, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
          <CalendarDays size={13} />Días de pago
        </div>
        <div className="chips" style={{ marginBottom: 8 }}>
          {paydays.length === 0 && !paydayPickerOpen && (
            <span style={{ fontFamily: "-apple-system, sans-serif", fontSize: "0.78rem", color: "#9a8f77" }}>Ninguno marcado todavía.</span>
          )}
          {[...paydays].sort((a, b) => a - b).map((p) => (
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
              <div className="item" key={x.id}>
                <span>{x.desc}<span className="day">día {x.day}</span></span>
                <span><span className="amt">${fmt(Number(x.amount))}</span>
                  <button className="del" style={{ padding: 0 }} onClick={() => setExtraIncomes((xs) => xs.filter((y) => y.id !== x.id))}><Trash2 size={13} /></button>
                </span>
              </div>
            ))}
            <div className="item" style={{ borderBottom: "none", fontWeight: 700 }}>
              <span>{extraIncomes.length} ingreso{extraIncomes.length === 1 ? "" : "s"} extra este mes</span>
              <span className="amt">${fmt(totalExtraIncome)}</span>
            </div>
          </div>
        ) : (
          <p style={{ fontFamily: "-apple-system, sans-serif", fontSize: "0.8rem", color: "#6b6455", margin: "4px 0" }}>Aún no registras ingresos extra este mes.</p>
        )}
      </div>

      <div className="sheet">
        <h2>Gastos y deudas</h2>
        <p style={{ fontFamily: "-apple-system, sans-serif", fontSize: "0.74rem", color: "#6b6455", margin: "0 0 8px" }}>
          Todo en un solo lugar: lo fijo sin fecha de fin, y lo que tiene saldo — deudas, tarjeta de crédito o compras a cuotas.
        </p>
        {items.map((it) => {
          if (it.type === "fijo") {
            return (
              <div className="row" key={it.id}>
                <span className="type-tag fijo">Fijo</span>
                <input type="text" value={it.name} onChange={(ev) => updateItem(it.id, "name", ev.target.value)} />
                <input type="number" value={it.amount} onChange={(ev) => updateItem(it.id, "amount", ev.target.value)} />
                <button className="del" onClick={() => removeItem(it.id)}><Trash2 size={15} /></button>
              </div>
            );
          }
          const dueIn = daysUntilDue(it.dueDay, now);
          const cuotasRestantes = Number(it.minPayment) > 0 ? Math.ceil(Number(it.balance) / Number(it.minPayment)) : null;
          const deadlineDays = daysUntilDate(it.deadlineDate, now);
          const statusLine = (dueIn !== null || cuotasRestantes !== null || deadlineDays !== null) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontFamily: "-apple-system, sans-serif", fontSize: "0.72rem", marginTop: 5, paddingLeft: 2, fontWeight: 600 }}>
              {dueIn !== null && (
                <span style={{ color: dueIn <= 3 ? "var(--debt)" : "#8a7a3d" }}>{dueIn === 0 ? "Vence hoy" : `${dueIn} día${dueIn === 1 ? "" : "s"} para tu próximo pago`}</span>
              )}
              {cuotasRestantes !== null && (
                <span style={{ color: "#6b6455" }}>
                  ~{cuotasRestantes}{it.totalInstallments ? ` de ${it.totalInstallments}` : ""} cuota{cuotasRestantes === 1 ? "" : "s"} restante{cuotasRestantes === 1 ? "" : "s"}
                </span>
              )}
              {deadlineDays !== null && (
                <span style={{ color: deadlineDays <= 7 ? "var(--debt)" : "#8a7a3d" }}>
                  {deadlineDays < 0 ? `Plazo vencido${it.deadlineNote ? ` — ${it.deadlineNote}` : ""}` : deadlineDays === 0 ? `¡Plazo hoy!${it.deadlineNote ? ` — ${it.deadlineNote}` : ""}` : `${deadlineDays} día${deadlineDays === 1 ? "" : "s"} para el plazo${it.deadlineNote ? ` (${it.deadlineNote})` : ""}`}
                </span>
              )}
            </div>
          );

          if (!expandedDebtIds.includes(it.id)) {
            return (
              <div className="debt-card" key={it.id}>
                <div className="debt-card-top">
                  <span className="type-tag deuda">Deuda/cuota</span>
                  <span className="debt-card-name">{it.name}</span>
                  <div className="debt-card-actions">
                    <button className="icon-btn" onClick={() => toggleDebtExpanded(it.id)} title="Editar"><Pencil size={13} /></button>
                    <button className="icon-btn" onClick={() => removeItem(it.id)} title="Eliminar"><Trash2 size={13} /></button>
                  </div>
                </div>
                <div className="debt-card-numbers">
                  <span className="debt-card-balance">${fmt(Number(it.balance))}</span>
                  {Number(it.rate) > 0 && <span className="chip-mini">{it.rate}% anual</span>}
                  {Number(it.minPayment) > 0 && <span className="chip-mini">mín ${fmt(Number(it.minPayment))}</span>}
                </div>
                {statusLine}
              </div>
            );
          }

          return (
            <div key={it.id} style={{ borderBottom: "1px solid var(--line)", paddingBottom: 6, marginBottom: 6 }}>
              <div className="row" style={{ borderBottom: "none", paddingBottom: 2 }}>
                <span className="type-tag deuda">Deuda/cuota</span>
                <input type="text" value={it.name} onChange={(ev) => updateItem(it.id, "name", ev.target.value)} />
                <button className="icon-btn" onClick={() => toggleDebtExpanded(it.id)} title="Listo"><ChevronDown size={15} /></button>
                <button className="del" onClick={() => removeItem(it.id)}><Trash2 size={15} /></button>
              </div>
              <div style={{ display: "flex", gap: 12, fontFamily: "-apple-system, sans-serif", fontSize: "0.72rem", color: "#6b6455", paddingLeft: 2 }}>
                <label style={{ flex: 1 }}>Saldo
                  <input type="number" value={it.balance} onChange={(ev) => updateItem(it.id, "balance", ev.target.value)}
                    style={{ display: "block", width: "100%", border: "none", borderBottom: "1px dashed var(--line)", background: "transparent", fontFamily: "'SFMono-Regular', Consolas, monospace", padding: "3px 0" }} />
                </label>
                <label style={{ flex: 1 }}>Tasa anual %
                  <input type="number" value={it.rate} onChange={(ev) => updateItem(it.id, "rate", ev.target.value)}
                    style={{ display: "block", width: "100%", border: "none", borderBottom: "1px dashed var(--line)", background: "transparent", fontFamily: "'SFMono-Regular', Consolas, monospace", padding: "3px 0" }} />
                </label>
              </div>
              <div style={{ display: "flex", gap: 12, fontFamily: "-apple-system, sans-serif", fontSize: "0.72rem", color: "#6b6455", paddingLeft: 2, marginTop: 6 }}>
                <label style={{ flex: 1 }}>Pago mínimo
                  <input type="number" value={it.minPayment} onChange={(ev) => updateItem(it.id, "minPayment", ev.target.value)}
                    style={{ display: "block", width: "100%", border: "none", borderBottom: "1px dashed var(--line)", background: "transparent", fontFamily: "'SFMono-Regular', Consolas, monospace", padding: "3px 0" }} />
                </label>
                <label style={{ flex: 1 }}>N° de cuotas (opcional)
                  <input type="number" min="0" placeholder="ej: 12" value={it.totalInstallments}
                    onChange={(ev) => updateInstallments(it.id, ev.target.value)}
                    style={{ display: "block", width: "100%", border: "none", borderBottom: "1px dashed var(--line)", background: "transparent", fontFamily: "'SFMono-Regular', Consolas, monospace", padding: "3px 0" }} />
                </label>
              </div>
              <div style={{ display: "flex", gap: 12, fontFamily: "-apple-system, sans-serif", fontSize: "0.72rem", color: "#6b6455", paddingLeft: 2, marginTop: 6 }}>
                <label style={{ flex: 1 }}>Día de pago
                  <input type="number" min="1" max="31" placeholder="1-31" value={it.dueDay} onChange={(ev) => updateItem(it.id, "dueDay", ev.target.value)}
                    style={{ display: "block", width: "100%", border: "none", borderBottom: "1px dashed var(--line)", background: "transparent", fontFamily: "'SFMono-Regular', Consolas, monospace", padding: "3px 0" }} />
                </label>
                <label style={{ flex: 1 }}>Plazo límite (opcional)
                  <input type="date" value={it.deadlineDate || ""} onChange={(ev) => updateItem(it.id, "deadlineDate", ev.target.value)}
                    style={{ display: "block", width: "100%", border: "none", borderBottom: "1px dashed var(--line)", background: "transparent", fontFamily: "'SFMono-Regular', Consolas, monospace", padding: "3px 0", fontSize: "0.7rem" }} />
                </label>
              </div>
              <div style={{ marginTop: 6, paddingLeft: 2 }}>
                <input type="text" placeholder="¿Qué pasa si no pagas a tiempo? ej: pierdo 0% de la TC" value={it.deadlineNote || ""}
                  onChange={(ev) => updateItem(it.id, "deadlineNote", ev.target.value)}
                  style={{ display: "block", width: "100%", border: "none", borderBottom: "1px dashed var(--line)", background: "transparent", fontFamily: "-apple-system, sans-serif", fontSize: "0.72rem", padding: "3px 0", color: "#6b6455" }} />
              </div>
              {statusLine}
            </div>
          );
        })}
        <div className="addrow">
          <button className="addbtn" onClick={addFijo}><Plus size={14} /> Gasto fijo</button>
          <button className="addbtn" onClick={addDeuda}><Plus size={14} /> Deuda o compra a cuotas</button>
        </div>
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
              <div className="item" key={x.id}>
                <span>{x.desc}<span className="day">día {x.day}</span></span>
                <span><span className="amt">${fmt(Number(x.amount))}</span>
                  <button className="del" style={{ padding: 0 }} onClick={() => setUnexpectedExpenses((xs) => xs.filter((y) => y.id !== x.id))}><Trash2 size={13} /></button>
                </span>
              </div>
            ))}
            <div className="item" style={{ borderBottom: "none", fontWeight: 700 }}>
              <span>Total inesperados este mes</span>
              <span className="amt">${fmt(unexpectedExpenses.reduce((s, e) => s + Number(e.amount || 0), 0))}</span>
            </div>
          </div>
        ) : (
          <p style={{ fontFamily: "-apple-system, sans-serif", fontSize: "0.8rem", color: "#6b6455", margin: "4px 0" }}>Sin gastos inesperados registrados este mes.</p>
        )}
      </div>

      <div className="sheet">
        <h2><PiggyBank size={14} />Metas de ahorro</h2>
        <div className="quickadd">
          <input type="text" placeholder="¿Para qué? ej: seguro del carro" value={newGoal.name} onChange={(e) => setNewGoal((v) => ({ ...v, name: e.target.value }))} />
          <input type="number" placeholder="Meta $" value={newGoal.targetAmount} onChange={(e) => setNewGoal((v) => ({ ...v, targetAmount: e.target.value }))} />
          <input type="date" value={newGoal.targetDate} onChange={(e) => setNewGoal((v) => ({ ...v, targetDate: e.target.value }))} />
          <button className="go" onClick={addGoal}><Plus size={15} /></button>
        </div>
        {goalsCalc.length === 0 ? (
          <p style={{ fontFamily: "-apple-system, sans-serif", fontSize: "0.8rem", color: "#6b6455", margin: "4px 0" }}>Sin metas de ahorro registradas.</p>
        ) : (
          <>
            {goalsCalc.map((g) => (
              <div className="goal-card" key={g.id}>
                <div className="row" style={{ borderBottom: "none", paddingBottom: 2 }}>
                  <input type="text" value={g.name} onChange={(ev) => updateGoal(g.id, "name", ev.target.value)} />
                  <button className="del" onClick={() => removeGoal(g.id)}><Trash2 size={15} /></button>
                </div>
                <div className="goal-fields">
                  <label>Ahorrado<input type="number" value={g.savedAmount} onChange={(ev) => updateGoal(g.id, "savedAmount", ev.target.value)} /></label>
                  <label>Meta<input type="number" value={g.targetAmount} onChange={(ev) => updateGoal(g.id, "targetAmount", ev.target.value)} /></label>
                  <label>Fecha<input type="date" value={g.targetDate || ""} onChange={(ev) => updateGoal(g.id, "targetDate", ev.target.value)} style={{ fontSize: "0.68rem" }} /></label>
                </div>
                <div className="goal-progress" style={{ color: g.remaining <= 0 ? "var(--free)" : g.requiredMonthly > disponible ? "var(--debt)" : "#8a7a3d" }}>
                  {g.remaining <= 0
                    ? "¡Meta alcanzada!"
                    : g.daysLeft === null
                    ? `Faltan $${fmt(g.remaining)} — pon una fecha para calcular cuánto apartar en cada pago`
                    : g.daysLeft < 0
                    ? `Faltan $${fmt(g.remaining)} — la fecha ya pasó`
                    : sortedPaydays.length === 0
                    ? `Faltan $${fmt(g.remaining)} (${g.daysLeft} días) — agrega tus días de pago arriba para calcular cuánto apartar en cada uno`
                    : g.paydaysLeft === 0
                    ? `Faltan $${fmt(g.remaining)} — tu próximo pago cae después de esta fecha, solo cuenta lo que ya tengas ahorrado`
                    : `Faltan $${fmt(g.remaining)} (${g.daysLeft} días) — te quedan ${g.paydaysLeft} pago${g.paydaysLeft === 1 ? "" : "s"} antes de esa fecha: aparta ~$${fmt(g.requiredPerPayday)} de cada uno`}
                </div>
              </div>
            ))}

            {(() => {
              if (totalRequiredMonthly <= 0) return null;
              const urgentGoal = goalsCalc
                .filter((g) => g.remaining > 0 && g.daysLeft !== null)
                .sort((a, b) => a.daysLeft - b.daysLeft)[0];
              const goalIsUrgent = urgentGoal && urgentGoal.daysLeft <= 45;

              if (totalRequiredMonthly <= disponible) {
                return (
                  <div className="plan-action">
                    Tu disponible mensual (<b>${fmt(disponible)}</b>) alcanza para tus metas de ahorro (<b>${fmt(totalRequiredMonthly)}</b>)
                    y aún te quedarían <b>${fmt(disponible - totalRequiredMonthly)}</b> para acelerar el pago de tus deudas.
                  </div>
                );
              }
              const shortfall = totalRequiredMonthly - disponible;
              return (
                <div className="warn">
                  Tus metas de ahorro necesitan <b>${fmt(totalRequiredMonthly)}</b>/mes pero tu disponible es de <b>${fmt(disponible)}</b> (te faltan <b>${fmt(shortfall)}</b>).
                  {highestRateDebt && Number(highestRateDebt.rate) >= 15 && !goalIsUrgent && (
                    <> Como tienes una deuda al <b>{highestRateDebt.rate}%</b> de interés y ninguna meta vence pronto, podría convenirte pausar el abono extra a esa deuda este mes y priorizar completar tus metas de ahorro.</>
                  )}
                  {goalIsUrgent && (
                    <> Como <b>{urgentGoal.name}</b> vence en {urgentGoal.daysLeft} días, prioriza esa meta primero, incluso si eso significa pagar solo el mínimo de tus deudas este mes.</>
                  )}
                </div>
              );
            })()}
            <div className="disclaimer">Esto es una guía general para organizar tu dinero, no un consejo financiero profesional.</div>
          </>
        )}
      </div>

      <div className="sheet">
        <h2>Plan de pago</h2>
        <p style={{ fontFamily: "-apple-system, sans-serif", fontSize: "0.74rem", color: "#6b6455", margin: "0 0 6px" }}>Elige cómo priorizar tu dinero extra entre deudas y compras a cuotas:</p>
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
                Así reparte tu dinero para deudas y compras a cuotas cada mes:
                <ul>
                  {sortedPaydays.map((p) => (
                    <li key={p}>
                      <b>Día {p}</b>: separa <b>${fmt(perPaydayMin)}</b> para pagos mínimos
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
          <p style={{ fontFamily: "-apple-system, sans-serif", fontSize: "0.85rem", color: "#6b6455" }}>Agrega al menos una deuda o compra a cuotas con saldo mayor a cero para ver el plan.</p>
        )}
      </div>
    </div>
  );
}
