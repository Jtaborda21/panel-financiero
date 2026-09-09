import { createClient } from "@supabase/supabase-js";

// Estas dos variables vienen de tu proyecto de Supabase (Settings > API):
// - VITE_SUPABASE_URL: la URL del proyecto
// - VITE_SUPABASE_ANON_KEY: la clave pública "anon" (segura para usar en el navegador,
//   el acceso real a los datos lo controla Row Level Security en la base de datos)
//
// En desarrollo local van en un archivo .env en la raíz del proyecto (ya está en
// .gitignore, nunca se sube a GitHub). En producción (Vercel) se configuran como
// variables de entorno del proyecto.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY. Crea un archivo .env " +
      "(mira .env.example) con las credenciales de tu proyecto de Supabase."
  );
}

export const supabase = createClient(supabaseUrl || "", supabaseAnonKey || "");

