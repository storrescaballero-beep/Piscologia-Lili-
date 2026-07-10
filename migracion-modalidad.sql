-- Ejecutar UNA VEZ en Supabase: SQL Editor > New query > pegar y "Run"
-- Separa Centro y Modalidad en dos columnas para poder automatizar
-- el cálculo del alquiler a David en sesiones presenciales en su centro.

alter table sesiones add column if not exists modalidad text;

-- Nota: las sesiones antiguas ya tienen texto libre en "centro" (ej. "Centro David - Presencial").
-- No se pueden separar automáticamente sin revisarlas una a una, así que quedarán con
-- modalidad en blanco hasta que las edites manualmente desde la web (bastan unos segundos por fila).
