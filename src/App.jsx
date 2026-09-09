import React, { useState, useMemo, useEffect, useRef } from "react";
import { Plus, Trash2, ArrowDownWideNarrow, Flame, CalendarDays, Zap, X, PiggyBank, Sparkles, Undo2, KeyRound } from "lucide-react";

const uid = () => Math.random().toString(36).slice(2, 9);

const DEFAULT_ITEMS = [
  { id: uid(), type: "fijo", name: "Arriendo / vivienda", amount: 0 },
  { id: uid(), type: "fijo", name: "Comida", amount: 0 },
  { id: uid(), type: "fijo", name: "Transporte", amount: 0 },
  { id: uid(), type: "fijo", name: "Universidad (matrícula, materiales)", amount: 0 },
  { id: uid(), type: "fijo", name: "Servicios y celular", amount: 0 },
  { id: uid(), type: "deuda", name: "Deuda 1", balance: 0, rate: 0, minPayment: 0, totalInstallments: "", dueDay: "", deadlineDate: "", deadlineNote: "" },
];

// --- Almacenamiento local (reemplaza el window.storage del entorno de artifacts) ---
// Todo queda guardado en el navegador del usuario (localStorage), por eso no
// sincroniza automáticamente entre dispositivos: para eso está la sección de
// "Respaldo manual" (exportar/importar texto) que ya trae la app.
const storage = {
  get(key) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? null : { value: raw };
    } catch (err) {
      return null;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (err) {}
  },
  delete(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (err) {}
  },
};

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

function keySafe(s) {
  const clean = (s || "").trim().toLowerCase().replace(/[\s\/\\'"]+/g, "-");
  return clean.slice(0, 60) || "default";
}

const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

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
  const [backupText, setBackupText] = useState("");
  const [importText, setImportText] = useState("");
  const [backupMsg, setBackupMsg] = useState("");
  const [botInput, setBotInput] = useState("");
  const [botLoading, setBotLoading] = useState(false);
  const [botMessage, setBotMessage] = useState("");
  const [botLastAction, setBotLastAction] = useState(null);

  const loadedRef = useRef(false);
  const [loaded, setLoaded] = useState(false);

  const [passphrase, setPassphrase] = useState(null);
  const [checkingDevice, setCheckingDevice] = useState(true);
  const [pkInput, setPkInput] = useState("");

  // Clave de Anthropic que el propio usuario pega para usar el clasificador
  // de IA. Se guarda solo en este navegador (localStorage), nunca se envía
  // a ningún servidor propio: va directo del navegador a la API de Anthropic.
  const [apiKey, setApiKey] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showApiKeyForm, setShowApiKeyForm] = useState(false);

  useEffect(() => {
    const r = storage.get("device-passphrase");
    if (r && r.value) setPassphrase(r.value);
    const k = storage.get("anthropic-api-key");
    if (k && k.value) setApiKey(k.value);
    setCheckingDevice(false);
  }, []);

  const submitPassphrase = () => {
    if (!pkInput.trim()) return;
    const safe = keySafe(pkInput);
    storage.set("device-passphrase", safe);
    setPassphrase(safe);
  };

  const changePassphrase = () => {
    storage.delete("device-passphrase");
    loadedRef.current = false;
    setLoaded(false);
    setPkInput("");
    setPassphrase(null);
  };

  const saveApiKey = () => {
    const trimmed = apiKeyInput.trim();
    if (!trimmed) return;
    storage.set("anthropic-api-key", trimmed);
    setApiKey(trimmed);
    setApiKeyInput("");
    setShowApiKeyForm(false);
  };

  const clearApiKey = () => {
    storage.delete("anthropic-api-key");
    setApiKey("");
  };

  // Migra el formato viejo (expenses[] + debts[]) al nuevo items[] unificado
  function migrateToItems(c) {
    if (c.items) return c.items;
    const out = [];
    (c.expenses || []).forEach((e) => {
      const cuotas = Number(e.installments);
      if (e.installments !== undefined && e.installments !== "" && cuotas > 0) {
        out.push({
          id: uid(), type: "deuda", name: e.name,
          balance: Number(e.amount || 0) * cuotas, rate: 0, minPayment: Number(e.amount || 0),
          totalInstallments: String(cuotas), dueDay: "", deadlineDate: "", deadlineNote: "",
        });
      } else {
        out.push({ id: e.id || uid(), type: "fijo", name: e.name, amount: e.amount });
      }
    });
    (c.debts || []).forEach((d) => {
      out.push({
        id: d.id || uid(), type: "deuda", name: d.name, balance: d.balance, rate: d.rate,
        minPayment: d.minPayment, totalInstallments: d.totalInstallments || "",
        dueDay: d.dueDay || "", deadlineDate: d.deadlineDate || "", deadlineNote: d.deadlineNote || "",
      });
    });
    return out.length > 0 ? out : null;
  }

  useEffect(() => {
    if (!passphrase) return;

    let finalItems = null;
    let finalGoals = null;
    let finalIncomeFixed, finalPaydays, finalMethod;

    const cfg = storage.get(`sync:${passphrase}:config`);
    if (cfg && cfg.value) {
      try {
        const c = JSON.parse(cfg.value);
        finalIncomeFixed = c.incomeFixed;
        finalPaydays = c.paydays;
        finalMethod = c.method;
        finalGoals = c.savingsGoals || [];
        finalItems = migrateToItems(c);
      } catch (err) {}
    }

    if (finalIncomeFixed !== undefined) setIncomeFixed(finalIncomeFixed);
    if (finalPaydays) setPaydays(finalPaydays);
    if (finalMethod) setMethod(finalMethod);
    if (finalItems) setItems(finalItems);
    if (finalGoals) setSavingsGoals(finalGoals);

    let monthData = null;
    const m = storage.get(`sync:${passphrase}:month:${mKey}`);
    if (m && m.value) {
      try {
        monthData = JSON.parse(m.value);
      } catch (err) {}
    }
    if (monthData) {
      if (monthData.extraIncomes) setExtraIncomes(monthData.extraIncomes);
      if (monthData.unexpectedExpenses) setUnexpectedExpenses(monthData.unexpectedExpenses);
    }

    loadedRef.current = true;
    setLoaded(true);
  }, [mKey, passphrase]);

  useEffect(() => {
    if (!loadedRef.current || !passphrase) return;
    const t = setTimeout(() => {
      storage.set(`sync:${passphrase}:config`, JSON.stringify({ incomeFixed, paydays, items, savingsGoals, method }));
    }, 400);
    return () => clearTimeout(t);
  }, [incomeFixed, paydays, items, savingsGoals, method, passphrase]);

  useEffect(() => {
    if (!loadedRef.current || !passphrase) return;
    const t = setTimeout(() => {
      storage.set(`sync:${passphrase}:month:${mKey}`, JSON.stringify({ extraIncomes, unexpectedExpenses }));
    }, 400);
    return () => clearTimeout(t);
  }, [extraIncomes, unexpectedExpenses, mKey, passphrase]);

  const fixedItems = items.filter((it) => it.type === "fijo");
  const debtItems = items.filter((it) => it.type === "deuda");

  const totalExtraIncome = extraIncomes.reduce((s, e) => s + Number(e.amount || 0), 0);
  const totalIncome = Number(incomeFixed) + totalExtraIncome;
  const totalExpenses =
    fixedItems.reduce((s, e) => s + Number(e.amount || 0), 0) +
    unexpectedExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const totalMinPayments = debtItems.reduce((s, d) => s + Number(d.minPayment || 0), 0);
  const disponible = totalIncome - totalExpenses - totalMinPayments;

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
  const addDeuda = () =>
    setItems((xs) => [
      ...xs,
      { id: uid(), type: "deuda", name: "Nueva deuda o compra", balance: 0, rate: 0, minPayment: 0, totalInstallments: "", dueDay: "", deadlineDate: "", deadlineNote: "" },
    ]);
  const removeItem = (id) => setItems((xs) => xs.filter((x) => x.id !== id));

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

  const exportBackup = () => {
    const data = { incomeFixed, paydays, items, savingsGoals, method, extraIncomes, unexpectedExpenses, exportedMonth: mKey };
    setBackupText(JSON.stringify(data, null, 2));
    setBackupMsg("");
  };

  const copyBackup = async () => {
    try {
      await navigator.clipboard.writeText(backupText);
      setBackupMsg("Copiado. Guárdalo en Notas o donde quieras.");
    } catch (err) {
      setBackupMsg("No se pudo copiar automático — selecciona el texto y cópialo a mano.");
    }
  };

  const importBackup = () => {
    try {
      const data = JSON.parse(importText);
      if (data.incomeFixed !== undefined) setIncomeFixed(data.incomeFixed);
      if (data.paydays) setPaydays(data.paydays);
      if (data.items) setItems(data.items);
      if (data.savingsGoals) setSavingsGoals(data.savingsGoals);
      if (data.method) setMethod(data.method);
      if (data.exportedMonth === mKey) {
        if (data.extraIncomes) setExtraIncomes(data.extraIncomes);
        if (data.unexpectedExpenses) setUnexpectedExpenses(data.unexpectedExpenses);
      }
      setBackupMsg("Datos restaurados correctamente.");
      setImportText("");
    } catch (err) {
      setBackupMsg("Ese texto no es un respaldo válido — revisa que lo hayas copiado completo.");
    }
  };

  const handleBotSubmit = async () => {
    if (!botInput.trim()) return;
    if (!apiKey) {
      setShowApiKeyForm(true);
      setBotMessage("Primero necesitas pegar tu API key de Anthropic para usar el clasificador (ver abajo).");
      return;
    }
    setBotLoading(true);
    setBotMessage("");
    setBotLastAction(null);
    try {
      const prompt = `Eres un clasificador de frases informales en español sobre dinero para una app de finanzas personales. Hoy es ${now.toISOString().slice(0, 10)} (formato AAAA-MM-DD).

Frase del usuario: "${botInput.replace(/"/g, "'")}"

Clasifícala en uno de estos tipos y responde SOLO con un objeto JSON válido, sin texto adicional, sin markdown, sin explicaciones:

1. Gasto inesperado (compró o gastó algo una sola vez, sin cuotas):
{"type":"gasto_inesperado","name":"...","amount":numero}

2. Deuda o compra a cuotas (menciona cuotas, plazos, o una deuda):
{"type":"deuda","name":"...","balance":numero_total,"installments":numero_de_cuotas_o_null,"minPayment":valor_de_cada_cuota_o_null,"rate":numero_o_0}

3. Meta de ahorro (quiere ahorrar o juntar dinero para algo futuro):
{"type":"ahorro","name":"...","targetAmount":numero_o_null,"targetDate":"AAAA-MM-DD"_o_null}

4. Ingreso extra (le pagaron algo, ganó dinero, recibió un ingreso adicional):
{"type":"ingreso_extra","name":"...","amount":numero}

5. Si no logras entenderlo o no aplica a ninguna categoría:
{"type":"desconocido"}

Si menciona "N cuotas de X", balance = X * N y minPayment = X. Los montos son en pesos, sin puntos ni comas, solo el número. Responde solo el JSON, nada más.`;

      let res, data;
      try {
        res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
            "x-api-key": apiKey,
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-5",
            max_tokens: 300,
            messages: [{ role: "user", content: prompt }],
          }),
        });
        data = await res.json();
      } catch (netErr) {
        setBotMessage("No se pudo conectar con el servicio. Revisa tu internet e intenta de nuevo.");
        setBotLoading(false);
        return;
      }

      if (!res.ok) {
        const errMsg = (data && data.error && data.error.message) || `Error ${res.status}`;
        if (res.status === 401) {
          setBotMessage("Tu API key parece inválida o vencida. Revísala abajo.");
          setShowApiKeyForm(true);
        } else {
          setBotMessage(`El servicio respondió con un error: ${errMsg}`);
        }
        setBotLoading(false);
        return;
      }

      const raw = (data.content || []).map((c) => c.text || "").join("");
      const match = raw.match(/\{[\s\S]*\}/);
      let parsed;
      try {
        parsed = JSON.parse(match ? match[0] : raw.replace(/```json|```/g, "").trim());
      } catch (parseErr) {
        setBotMessage(`No entendí la respuesta del clasificador. Intenta reformular, ej: "gasté 15000 en salchipapas".`);
        setBotLoading(false);
        return;
      }

      if (parsed.type === "gasto_inesperado" && parsed.amount) {
        const newId = uid();
        setUnexpectedExpenses((xs) => [...xs, { id: newId, desc: parsed.name || "Gasto", amount: parsed.amount, day: now.getDate() }]);
        setBotMessage(`Agregado a Gasto inesperado: ${parsed.name} — $${fmt(Number(parsed.amount))}`);
        setBotLastAction({ list: "unexpectedExpenses", id: newId });
      } else if (parsed.type === "deuda" && parsed.balance) {
        const newId = uid();
        const cuotas = parsed.installments ? Number(parsed.installments) : "";
        const minPay = parsed.minPayment ? Number(parsed.minPayment) : cuotas ? Math.round(Number(parsed.balance) / cuotas) : 0;
        setItems((xs) => [...xs, {
          id: newId, type: "deuda", name: parsed.name || "Compra a cuotas",
          balance: Number(parsed.balance), rate: Number(parsed.rate) || 0, minPayment: minPay,
          totalInstallments: cuotas ? String(cuotas) : "", dueDay: "", deadlineDate: "", deadlineNote: "",
        }]);
        setBotMessage(`Agregado a Deudas y compras a cuotas: ${parsed.name} — $${fmt(Number(parsed.balance))}${cuotas ? ` en ${cuotas} cuotas` : ""}`);
        setBotLastAction({ list: "items", id: newId });
      } else if (parsed.type === "ahorro") {
        const newId = uid();
        setSavingsGoals((gs) => [...gs, { id: newId, name: parsed.name || "Meta de ahorro", savedAmount: 0, targetAmount: parsed.targetAmount || 0, targetDate: parsed.targetDate || "" }]);
        setBotMessage(`Agregado a Metas de ahorro: ${parsed.name}${parsed.targetAmount ? ` — meta $${fmt(Number(parsed.targetAmount))}` : ""}`);
        setBotLastAction({ list: "savingsGoals", id: newId });
      } else if (parsed.type === "ingreso_extra" && parsed.amount) {
        const newId = uid();
        setExtraIncomes((xs) => [...xs, { id: newId, desc: parsed.name || "Ingreso extra", amount: parsed.amount, day: now.getDate() }]);
        setBotMessage(`Agregado a Ingresos extra: ${parsed.name} — $${fmt(Number(parsed.amount))}`);
        setBotLastAction({ list: "extraIncomes", id: newId });
      } else {
        setBotMessage("No logré entender bien eso — intenta ser más específico, ej: \"gasté 15000 en salchipapas\" o \"compré un tv a 5 cuotas de 80000\".");
      }
      setBotInput("");
    } catch (err) {
      setBotMessage("Algo salió mal procesando eso. Intenta de nuevo, o agrégalo manual abajo.");
    }
    setBotLoading(false);
  };

  const undoBotAction = () => {
    if (!botLastAction) return;
    const { list, id } = botLastAction;
    if (list === "unexpectedExpenses") setUnexpectedExpenses((xs) => xs.filter((x) => x.id !== id));
    if (list === "items") setItems((xs) => xs.filter((x) => x.id !== id));
    if (list === "savingsGoals") setSavingsGoals((gs) => gs.filter((g) => g.id !== id));
    if (list === "extraIncomes") setExtraIncomes((xs) => xs.filter((x) => x.id !== id));
    setBotMessage("Deshecho.");
    setBotLastAction(null);
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

  if (checkingDevice) {
    return <div style={{ background: "#16213e", minHeight: 100 }} />;
  }

  if (!passphrase) {
    return (
      <div className="ledger">
        <style>{`
          .ledger { --navy:#16213e; --paper:#fbf8f1; --ink:#1c1b1f; --gold:#b8912f; font-family: Georgia, serif; background: var(--navy); color: var(--paper); padding: 40px 18px; max-width: 480px; margin: 0 auto; min-height: 100vh; box-sizing: border-box; }
          .ledger h1 { font-size: 1.4rem; margin: 0 0 8px; }
          .ledger p { font-family: -apple-system, sans-serif; font-size: 0.85rem; color: #c9c2ad; line-height: 1.5; }
          .ledger input { width: 100%; box-sizing: border-box; font-family: -apple-system, sans-serif; font-size: 1rem; padding: 10px; margin: 14px 0; border: 1px solid var(--gold); background: rgba(251,248,241,0.06); color: var(--paper); }
          .ledger input:focus { outline: none; }
          .ledger button { width: 100%; padding: 11px; background: var(--gold); border: none; color: var(--ink); font-weight: 700; font-family: -apple-system, sans-serif; cursor: pointer; }
        `}</style>
        <h1>Panel financiero</h1>
        <p>Crea una clave de acceso (una palabra o código que tú inventes) para organizar tus datos en este navegador.</p>
        <p style={{ color: "#e79aa6" }}>
          Ojo: esto no es una contraseña segura de verdad, y tus datos quedan guardados solo en este navegador (no en un servidor). Usa la sección de "Respaldo manual" para llevarlos a otro dispositivo.
        </p>
        <input type="text" placeholder="Tu clave (ej: llave-verde27)" value={pkInput}
          onChange={(e) => setPkInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitPassphrase()} />
        <button onClick={submitPassphrase}>Continuar</button>
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
        .backup textarea { width: 100%; box-sizing: border-box; font-family: 'SFMono-Regular', Consolas, monospace; font-size: 0.68rem; padding: 8px; border: 1px solid var(--line); background: #fff; color: var(--ink); min-height: 90px; margin: 6px 0; }
        .backup .go2 { background: var(--ink); color: var(--paper); border: none; padding: 8px 12px; font-family: -apple-system, sans-serif; font-size: 0.78rem; font-weight: 600; cursor: pointer; margin-right: 8px; margin-bottom: 8px; }
        .backup .msg { font-family: -apple-system, sans-serif; font-size: 0.75rem; color: var(--free); margin: 4px 0; }
        .apikey-box { background: rgba(184,145,47,0.08); border: 1px dashed var(--gold); padding: 10px; margin-top: 8px; }
        .apikey-box input { width: 100%; box-sizing: border-box; font-family: 'SFMono-Regular', Consolas, monospace; font-size: 0.78rem; padding: 7px; border: 1px solid var(--line); margin-bottom: 6px; }
      `}</style>

      <h1>Panel financiero</h1>
      <div className="subtitle">Ingreso, gastos, deudas, ahorro y plan de pago — mes actual</div>
      <div style={{ fontFamily: "-apple-system, sans-serif", fontSize: "0.72rem", color: "#c9c2ad", marginTop: -12, marginBottom: 18, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Clave local: <b style={{ color: "#e0d9c4" }}>{passphrase}</b></span>
        <button onClick={changePassphrase} style={{ background: "none", border: "none", color: "var(--gold)", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer", padding: 0 }}>cambiar</button>
      </div>

      <div className="sheet" style={{ borderLeft: "3px solid var(--gold)" }}>
        <h2><Sparkles size={14} />Cuéntame qué hiciste</h2>
        <p style={{ fontFamily: "-apple-system, sans-serif", fontSize: "0.74rem", color: "#6b6455", margin: "0 0 8px" }}>
          Escribe en tus palabras y yo lo clasifico: "gasté 15000 en salchipapas", "compré un tv a 5 cuotas de 80000", "quiero ahorrar 800000 para un celular en marzo".
        </p>
        <div className="quickadd">
          <input type="text" placeholder="¿Qué hiciste?" value={botInput} onChange={(e) => setBotInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !botLoading && handleBotSubmit()} />
          <button className="go" onClick={handleBotSubmit} disabled={botLoading}>
            {botLoading ? "..." : <Sparkles size={15} />}
          </button>
        </div>
        {botMessage && (
          <div style={{ fontFamily: "-apple-system, sans-serif", fontSize: "0.78rem", color: "var(--free)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span>{botMessage}</span>
            {botLastAction && (
              <button onClick={undoBotAction} style={{ background: "none", border: "none", color: "var(--debt)", fontWeight: 700, cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 3 }}>
                <Undo2 size={13} /> deshacer
              </button>
            )}
          </div>
        )}
        {apiKey ? (
          <p style={{ fontFamily: "-apple-system, sans-serif", fontSize: "0.66rem", color: "#9a8f77", marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
            <KeyRound size={11} /> API key guardada en este navegador.
            <button onClick={clearApiKey} style={{ background: "none", border: "none", color: "var(--debt)", cursor: "pointer", padding: 0, fontWeight: 600 }}>quitar</button>
          </p>
        ) : (
          <p style={{ fontFamily: "-apple-system, sans-serif", fontSize: "0.66rem", color: "#9a8f77", marginTop: 8, fontStyle: "italic" }}>
            Necesitas tu propia API key de Anthropic (console.anthropic.com) para usar el clasificador.{" "}
            <button onClick={() => setShowApiKeyForm((s) => !s)} style={{ background: "none", border: "none", color: "var(--gold)", cursor: "pointer", padding: 0, fontWeight: 700, textDecoration: "underline" }}>
              {showApiKeyForm ? "cerrar" : "agregar mi API key"}
            </button>
          </p>
        )}
        {showApiKeyForm && (
          <div className="apikey-box">
            <input type="password" placeholder="sk-ant-..." value={apiKeyInput} onChange={(e) => setApiKeyInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveApiKey()} />
            <button className="go2" style={{ padding: "6px 10px", fontSize: "0.72rem" }} onClick={saveApiKey}>Guardar clave</button>
          </div>
        )}
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
          return (
            <div key={it.id} style={{ borderBottom: "1px solid var(--line)", paddingBottom: 6, marginBottom: 6 }}>
              <div className="row" style={{ borderBottom: "none", paddingBottom: 2 }}>
                <span className="type-tag deuda">Deuda/cuota</span>
                <input type="text" value={it.name} onChange={(ev) => updateItem(it.id, "name", ev.target.value)} />
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
              {(dueIn !== null || cuotasRestantes !== null || deadlineDays !== null) && (
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
              )}
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

      <div className="sheet backup">
        <h2>Respaldo manual</h2>
        <p style={{ fontFamily: "-apple-system, sans-serif", fontSize: "0.74rem", color: "#6b6455", margin: "0 0 8px" }}>
          Tus datos viven solo en este navegador. Exporta tus datos como texto y guárdalo en Notas, correo, donde quieras — y así también los pasas a otro dispositivo pegándolos ahí.
        </p>
        <button className="go2" onClick={exportBackup}>Exportar mis datos</button>
        {backupText && (
          <>
            <textarea readOnly value={backupText} onFocus={(e) => e.target.select()} />
            <button className="go2" onClick={copyBackup}>Copiar al portapapeles</button>
          </>
        )}
        <p style={{ fontFamily: "-apple-system, sans-serif", fontSize: "0.74rem", color: "#6b6455", margin: "10px 0 4px" }}>Restaurar desde un respaldo:</p>
        <textarea placeholder="Pega aquí el texto de tu respaldo" value={importText} onChange={(e) => setImportText(e.target.value)} />
        <button className="go2" onClick={importBackup}>Restaurar</button>
        {backupMsg && <div className="msg">{backupMsg}</div>}
      </div>
    </div>
  );
}
