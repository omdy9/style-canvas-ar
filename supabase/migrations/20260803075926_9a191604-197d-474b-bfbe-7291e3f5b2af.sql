CREATE POLICY "Anyone can read wardrobe files"
  ON storage.objects FOR SELECT USING (bucket_id = 'wardrobe');

CREATE POLICY "Anyone can upload wardrobe files"
  ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'wardrobe');

CREATE POLICY "Anyone can delete wardrobe files"
  ON storage.objects FOR DELETE USING (bucket_id = 'wardrobe');