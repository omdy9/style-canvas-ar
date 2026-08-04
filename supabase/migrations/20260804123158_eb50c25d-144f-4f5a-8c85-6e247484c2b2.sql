-- Clear ownerless prototype rows so the owner column can be required.
DELETE FROM public.wardrobe_items;

ALTER TABLE public.wardrobe_items
  ADD COLUMN user_id uuid NOT NULL;

DROP POLICY IF EXISTS "Anyone can view wardrobe items" ON public.wardrobe_items;
DROP POLICY IF EXISTS "Anyone can add wardrobe items" ON public.wardrobe_items;
DROP POLICY IF EXISTS "Anyone can remove wardrobe items" ON public.wardrobe_items;

REVOKE ALL ON public.wardrobe_items FROM anon;
GRANT SELECT, INSERT, DELETE ON public.wardrobe_items TO authenticated;
GRANT ALL ON public.wardrobe_items TO service_role;

CREATE POLICY "Users can view their own wardrobe items"
  ON public.wardrobe_items FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can add their own wardrobe items"
  ON public.wardrobe_items FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can remove their own wardrobe items"
  ON public.wardrobe_items FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Storage: files live under "<user id>/<file>.png"
DROP POLICY IF EXISTS "Anyone can read wardrobe files" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can upload wardrobe files" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can delete wardrobe files" ON storage.objects;

CREATE POLICY "Users can read their own wardrobe files"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'wardrobe' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can upload their own wardrobe files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'wardrobe' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can delete their own wardrobe files"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'wardrobe' AND (storage.foldername(name))[1] = auth.uid()::text);