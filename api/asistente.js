// Función serverless (Vercel) que interpreta mensajes en lenguaje natural
// sobre finanzas personales usando la API de Anthropic (Claude) y devuelve
// una acción estructurada en JSON. La API key vive solo en el servidor
// (variable de entorno ANTHROPIC_API_KEY), nunca llega al navegador.

const MODEL = "claude-3-5-haiku-latest";

function buildSystemPrompt(context) {
  const ctx = context || {};
  return `Eres un asistente que interpreta mensajes en español sobre finanzas personales de un usuario y los convierte en UNA acción estructurada en JSON. Responde SOLO con un objeto JSON válido, sin texto adicional, sin markdown, sin comentarios, sin explicaciones.

Fecha de hoy: ${ctx.today || "desconocida"} (día del mes: ${ctx.dayOfMonth ?? "?"})
Mes actual (clave interna): ${ctx.month || "?"}

Datos actuales del usuario (úsalos para responder matchId con el id EXACTO cuando el usuario mencione algo que ya existe):
Sueldo fijo mensual: ${ctx.incomeFixed ?? 0}
Días de pago: ${(ctx.paydays || []).join(", ") || "ninguno"}
Gastos fijos (type "fijo"): ${JSON.stringify(ctx.fixedItems || [])}
Deudas, compras a cuotas y metas de ahorro (una meta de ahorro es una deuda con rate=0 y deadlineDate puesto): ${JSON.stringify(ctx.debtItems || [])}

Esquema de salida (usa null en los campos que no apliquen a esa intención):
{
  "intent": "unexpected_expense" | "extra_income" | "new_debt" | "update_debt" | "new_fixed_expense" | "update_fixed_expense" | "update_income" | "clarify" | "unknown",
  "summary": "resumen corto y claro en español de lo que se va a hacer, para mostrárselo al usuario antes de confirmar",
  "desc": string o null (descripción corta del gasto/ingreso),
  "amount": number o null (monto en pesos, solo el número, sin puntos ni comas),
  "day": number o null (día del mes 1-31 en que ocurrió; si no se menciona usa el día de hoy),
  "name": string o null (nombre para un nuevo gasto fijo o nueva deuda/meta de ahorro),
  "matchId": string o null (el id EXACTO de un gasto fijo o deuda/meta existente que el usuario menciona, tomado de las listas de arriba; null si es algo nuevo),
  "balance": number o null (saldo inicial para new_debt),
  "rate": number o null (tasa % anual; 0 si es meta de ahorro o no se menciona),
  "minPayment": number o null (pago mínimo mensual, si se menciona o se puede calcular de balance/totalInstallments),
  "totalInstallments": number o null (número de cuotas, si se menciona),
  "dueDay": number o null (día de pago fijo 1-31, si se menciona),
  "deadlineDate": string o null (fecha límite en ISO yyyy-mm-dd; resuelve fechas relativas como "para diciembre", "en 6 meses", "el 15 de enero" usando la fecha de hoy),
  "deadlineNote": string o null (qué pasa si no se cumple el plazo, si el usuario lo menciona),
  "field": string o null ("balance" | "rate" | "minPayment" | "totalInstallments" | "dueDay" | "deadlineDate" | "deadlineNote" | "amount"; el campo a actualizar en update_debt/update_fixed_expense),
  "op": "set" | "increase" | "decrease" (cómo aplicar "value" sobre el campo actual; usa "set" salvo que el usuario hable de sumar o restar/abonar),
  "value": number o string o null (nuevo valor, o cantidad a sumar/restar según "op"),
  "question": string o null (si necesitas más información antes de poder actuar, usa intent "clarify" y escribe aquí la pregunta concreta)
}

Reglas de interpretación:
- "me gasté X en Y" / "gasté X (en Y)" / "pagué X de Y" (gasto no fijo) → intent "unexpected_expense", desc=Y o motivo, amount=X.
- "me gané X extra" / "recibí X extra" / "me pagaron X" / "entró un ingreso de X" → intent "extra_income", desc=motivo, amount=X.
- "quiero ahorrar X para <fecha/mes>" / "meta de ahorro de X" / "necesito juntar X" → intent "new_debt" con rate=0, balance=X, deadlineDate resuelto a ISO, name descriptivo de la meta.
- "debo X en N cuotas" / "compré algo de X a N cuotas" / "nueva deuda/tarjeta de X" → intent "new_debt", balance=X, totalInstallments=N si se menciona, rate si se menciona (si no, 0), minPayment si se menciona o se puede inferir (balance/N cuotas).
- "le aboné/pagué X a <deuda existente>" / "aboné X a mi tarjeta" → intent "update_debt", matchId de esa deuda, field="balance", op="decrease", value=X.
- "mi <deuda existente> ahora tiene un saldo de X" / "me quedan X en <deuda>" → intent "update_debt", matchId, field="balance", op="set", value=X.
- "mi <gasto fijo existente> subió/cambió a X" / "ahora pago X de <gasto fijo>" → intent "update_fixed_expense", matchId, field="amount", op="set", value=X.
- "me subieron el sueldo a X" / "ahora gano X" → intent "update_income", op="set", value=X. "me subieron el sueldo en X" → op="increase", value=X.
- Si el usuario menciona un gasto fijo o deuda que NO existe en las listas de arriba con un nombre parecido, trátalo como nuevo (new_fixed_expense o new_debt), no inventes matchId.
- Si el mensaje no tiene un monto claro, o es ambiguo sobre a qué ítem existente se refiere (hay varias coincidencias posibles), usa intent "clarify" y pregunta específicamente lo que falta.
- Si el mensaje no tiene nada que ver con finanzas personales, usa intent "unknown" y explica brevemente en "summary" que no es algo que puedas registrar.
- Los montos son en pesos colombianos: en el JSON van como número plano (50000), nunca como texto ni con puntos/comas.
- Responde ÚNICAMENTE el objeto JSON, nada de texto antes ni después.`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método no permitido." });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error:
        "Falta configurar ANTHROPIC_API_KEY como variable de entorno en Vercel para que el asistente funcione.",
    });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  const { message, context } = body || {};

  if (!message || typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "Falta el mensaje a interpretar." });
    return;
  }

  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600,
        system: buildSystemPrompt(context),
        messages: [{ role: "user", content: message.trim() }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      res.status(502).json({ error: "Error llamando a la IA: " + errText.slice(0, 300) });
      return;
    }

    const data = await anthropicRes.json();
    const raw = (data.content || [])
      .map((block) => (block && block.type === "text" ? block.text : ""))
      .join("")
      .trim();

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      res.status(200).json({ intent: "unknown", summary: "No pude entender ese mensaje, intenta reformularlo." });
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      res.status(200).json({ intent: "unknown", summary: "No pude interpretar la respuesta del asistente." });
      return;
    }

    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: "Error interno del asistente: " + (err && err.message ? err.message : String(err)) });
  }
}
