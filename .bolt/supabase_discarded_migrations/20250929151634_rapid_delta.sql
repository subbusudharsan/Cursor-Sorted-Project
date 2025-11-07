@@ .. @@
 -- Add constraints for data validation
 ALTER TABLE public.profiles 
-ADD CONSTRAINT IF NOT EXISTS check_phone_number_format 
+ADD CONSTRAINT check_phone_number_format 
 CHECK (((phone_number IS NULL) OR (phone_number ~ '^\\+[1-9]\\d{1,14}$'::text)));