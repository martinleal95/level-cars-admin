-- =====================================================================
-- Level Cars · Migración 0004: almacenamiento privado de fotos.
-- El bucket es privado: las fotos solo se ven con enlaces firmados y
-- temporales que genera el servidor para un administrador logueado.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos-bienes', 'fotos-bienes', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy fotos_bienes_ver on storage.objects
  for select to authenticated
  using (bucket_id = 'fotos-bienes' and (select private.es_admin()));

create policy fotos_bienes_subir on storage.objects
  for insert to authenticated
  with check (bucket_id = 'fotos-bienes' and (select private.es_admin()));

create policy fotos_bienes_borrar on storage.objects
  for delete to authenticated
  using (bucket_id = 'fotos-bienes' and (select private.es_admin()));
