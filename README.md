# Registro de sesiones y pagos

Web estática (HTML/JS puro, sin build) con login por usuario y datos compartidos entre las 3 personas del equipo. Usa **Supabase** (gratis) para autenticación + base de datos, y **SheetJS** para exportar a Excel real.

## 1. Crear el proyecto en Supabase

1. Ve a [supabase.com](https://supabase.com) → crea una cuenta gratuita → **New project**.
2. Cuando esté listo, ve a **SQL Editor** → pega el contenido de `schema.sql` → **Run**.
3. Ve a **Authentication → Users → Add user** y crea las 3 personas manualmente:
   - Email + contraseña
   - Marca **Auto Confirm User** (para que no haga falta verificar email)
4. Ve a **Project Settings → API** y copia:
   - **Project URL**
   - **anon public key**

## 2. Configurar la web

Abre `config.js` y pega ahí esos dos valores:

```js
window.SUPABASE_URL = "https://tu-proyecto.supabase.co";
window.SUPABASE_ANON_KEY = "tu-anon-key";
```

## 3. Subir a GitHub

```bash
cd registro-pagos-web
git init
git add .
git commit -m "Registro de sesiones y pagos"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/registro-pagos.git
git push -u origin main
```

## 4. Desplegar en Vercel

1. Entra en [vercel.com](https://vercel.com) → **Add New Project** → importa el repo de GitHub.
2. Framework preset: **Other** (no hace falta build command, es HTML estático).
3. Deploy.
4. Comparte la URL de Vercel con las 3 personas — cada una entra con el email/contraseña que creaste en el paso 1.

## Notas

- **Realtime**: si dos personas tienen la web abierta a la vez, los cambios de una se reflejan automáticamente en la pantalla de la otra (sin recargar).
- **Seguridad**: las políticas RLS de `schema.sql` permiten leer/escribir a cualquier usuario autenticado del proyecto. Como solo existen los 3 usuarios que creaste a mano, es equivalente a un acceso privado del equipo.
- **Añadir/quitar personas**: se gestiona desde Supabase → Authentication → Users, sin tocar código.
- **Exportar Excel**: el botón "Exportar Excel" respeta los filtros activos (búsqueda, estado, mes) — si filtras por un mes y exportas, solo baja ese mes.
