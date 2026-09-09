# Panel financiero

App personal de finanzas hecha en React + Vite: ingresos, gastos fijos, deudas y compras a cuotas, y un plan de pago automático (método avalancha o bola de nieve). Una meta de ahorro se modela como una deuda con tasa 0% y fecha límite.

## Cómo correrla

```
npm install
npm run dev
```

Abre la URL que muestre la terminal (normalmente http://localhost:5173).

Necesitas un archivo `.env` en la raíz del proyecto (mira `.env.example`) con las credenciales de tu proyecto de Supabase:

```
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu-clave-anon-publica
```

## Cómo funciona el guardado de datos

Los datos se guardan en Supabase (Postgres + autenticación), no en el localStorage del navegador. Eso significa:

- Cada usuario inicia sesión con su correo y contraseña.
- Los datos quedan asociados a esa cuenta y se sincronizan automáticamente entre cualquier dispositivo donde inicies sesión con el mismo correo (PC, celular, etc.).
- La tabla `user_data` en Supabase usa Row Level Security para que cada usuario solo pueda ver y modificar sus propios datos.

## Estructura

- `src/App.jsx` — toda la lógica y la interfaz de la app, organizada en componentes pequeños (Header, StatsSnapshot, MonthlyChart, DebtItem, etc.).
- `src/main.jsx` — punto de entrada de React.
- `src/supabaseClient.js` — cliente de Supabase inicializado con las variables de entorno.
- `src/index.css` — estilos base mínimos (el resto de estilos vive dentro de App.jsx).
