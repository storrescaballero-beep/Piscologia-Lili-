-- Ejecutar UNA VEZ en Supabase: SQL Editor > New query > pegar y "Run"
-- Guarda el NIF y la clave/subclave fiscal de cada persona a la que se retiene IRPF,
-- para poder generar los modelos 111 (trimestral) y 190 (resumen anual).

create table if not exists fiscal_datos (
  persona text primary key,
  nif text,
  clave text default 'G',
  subclave text default '01',
  updated_at timestamptz default now()
);

alter table fiscal_datos enable row level security;

-- Solo Isabel (directora) puede ver y editar estos datos fiscales
create policy "isabel_select_fiscal" on fiscal_datos
  for select using (auth.jwt() ->> 'email' = 'iperezfraile@gmail.com');

create policy "isabel_insert_fiscal" on fiscal_datos
  for insert with check (auth.jwt() ->> 'email' = 'iperezfraile@gmail.com');

create policy "isabel_update_fiscal" on fiscal_datos
  for update using (auth.jwt() ->> 'email' = 'iperezfraile@gmail.com');

create policy "isabel_delete_fiscal" on fiscal_datos
  for delete using (auth.jwt() ->> 'email' = 'iperezfraile@gmail.com');
