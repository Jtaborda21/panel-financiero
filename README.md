# Panel financiero

App personal de finanzas hecha en React + Vite: ingresos, gastos fijos, deudas y compras a cuotas, metas de ahorro, y un plan de pago automático (método avalancha o bola de nieve).

## Cómo correrla

```bash
npm install
npm run dev
```

Abre la URL que muestre la terminal (normalmente http://localhost:5173).

## Cómo funciona el guardado de datos

Todo se guarda en el `localStorage` de tu navegador (no hay backend ni base de datos). Eso significa:

- Tus datos quedan solo en el navegador/dispositivo donde los cargaste.
- Si cambias de navegador o de computador, usa la sección **"Respaldo manual"** dentro de la app: exporta tus datos como texto, guárdalos donde quieras, y luego pégalos en la sección "Restaurar" del otro dispositivo.

## Función de IA ("Cuéntame qué hiciste")

Esta app tiene un cuadro donde puedes escribir en lenguaje natural (ej: "gasté 15000 en salchipapas") y un modelo de Claude clasifica automáticamente el gasto, deuda, ingreso o meta de ahorro.

Para usarla necesitas tu propia API key de Anthropic:

1. Crea una cuenta y una API key en https://console.anthropic.com
2. Dentro de la app, en la sección "Cuéntame qué hiciste", haz clic en "agregar mi API key" y pégala ahí.
3. La clave se guarda solo en el `localStorage` de tu navegador y las llamadas van directo de tu navegador a la API de Anthropic — nunca pasan por un servidor propio.

**Importante sobre seguridad:** llamar a la API de Anthropic directamente desde el navegador con tu API key significa que cualquiera que inspeccione el tráfico de red de tu navegador (por ejemplo con las herramientas de desarrollador) podría ver esa clave. Esto es aceptable para uso personal en tu propio navegador, pero **no publiques esta app en un sitio público** con tu clave cargada, porque cualquier visitante podría robarla y gastar tu saldo. Si más adelante quieres compartir la app con otras personas, lo correcto es mover esa llamada a un pequeño backend (por ejemplo una función serverless) que guarde la clave de forma segura del lado del servidor.

Si no quieres usar esta función, simplemente no agregues una API key: el resto de la app (gastos, deudas, metas, plan de pago) funciona sin ella.

## Estructura

- `src/App.jsx` — toda la lógica y la interfaz de la app.
- `src/main.jsx` — punto de entrada de React.
- `src/index.css` — estilos base mínimos (el resto de estilos vive dentro de `App.jsx`).
