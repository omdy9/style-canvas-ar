CREATE TABLE public.wardrobe_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'top',
  anchor TEXT NOT NULL DEFAULT 'torso',
  color TEXT NOT NULL DEFAULT '#cccccc',
  image_url TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, DELETE ON public.wardrobe_items TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wardrobe_items TO authenticated;
GRANT ALL ON public.wardrobe_items TO service_role;

ALTER TABLE public.wardrobe_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view wardrobe items"
  ON public.wardrobe_items FOR SELECT USING (true);

CREATE POLICY "Anyone can add wardrobe items"
  ON public.wardrobe_items FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can remove wardrobe items"
  ON public.wardrobe_items FOR DELETE USING (true);