-- Ejecutar en Supabase: Project > SQL Editor > New query > pegar y "Run"

create table if not exists sesiones (
  id uuid primary key default gen_random_uuid(),
  fecha_sesion date not null,
  paciente text not null,
  responsable_pago text,
  psicologa text,
  centro text,
  tipo_servicio text,
  precio numeric(10,2) default 0,
  forma_pago text,
  fecha_ingreso_banco date,
  estado_pago text default 'Pendiente',
  quipu boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table sesiones enable row level security;

-- Cualquier usuario autenticado (las 3 personas del equipo) puede leer y escribir
create policy "select_authenticated" on sesiones
  for select using (auth.role() = 'authenticated');

create policy "insert_authenticated" on sesiones
  for insert with check (auth.role() = 'authenticated');

create policy "update_authenticated" on sesiones
  for update using (auth.role() = 'authenticated');

create policy "delete_authenticated" on sesiones
  for delete using (auth.role() = 'authenticated');

-- Habilitar Realtime para esta tabla (para que las 3 personas vean cambios al instante)
alter publication supabase_realtime add table sesiones;
