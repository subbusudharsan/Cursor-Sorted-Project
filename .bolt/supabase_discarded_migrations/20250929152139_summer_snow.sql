```sql
-- Add new columns to the profiles table
ALTER TABLE public.profiles
ADD COLUMN first_name text,
ADD COLUMN last_name text,
ADD COLUMN phone_number text,
ADD COLUMN date_of_birth date,
ADD COLUMN nickname text,
ADD COLUMN country_code text,
ADD COLUMN country_name text;

-- Data migration: Split existing full_name into first_name and last_name
UPDATE public.profiles
SET
  first_name = split_part(full_name, ' ', 1),
  last_name = split_part(full_name, ' ', 2)
WHERE full_name IS NOT NULL;

-- Add indexes for efficient querying
CREATE INDEX idx_profiles_country_code ON public.profiles USING btree (country_code);
CREATE INDEX idx_profiles_phone_number ON public.profiles USING btree (phone_number);
CREATE INDEX idx_profiles_first_name ON public.profiles USING btree (first_name);
CREATE INDEX idx_profiles_last_name ON public.profiles USING btree (last_name);

-- Add constraints for data validation
ALTER TABLE public.profiles
ADD CONSTRAINT profiles_country_code_format CHECK (((country_code IS NULL) OR ((length(country_code) = 2) AND (country_code ~ '^[A-Z]{2}$'::text))));

ALTER TABLE public.profiles
ADD CONSTRAINT profiles_phone_number_format CHECK (((phone_number IS NULL) OR (phone_number ~ '^\\+[1-9]\\d{1,14}$'::text))));

ALTER TABLE public.profiles
ADD CONSTRAINT profiles_date_of_birth_range CHECK (((date_of_birth IS NULL) OR ((date_of_birth >= '1900-01-01'::date) AND (date_of_birth <= CURRENT_DATE))));

-- Create a function to update full_name from first_name and last_name
CREATE OR REPLACE FUNCTION public.update_full_name_from_parts()
RETURNS TRIGGER AS $$
BEGIN
    NEW.full_name := TRIM(CONCAT_WS(' ', NEW.first_name, NEW.last_name));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create a trigger to automatically update full_name when first_name or last_name changes
CREATE TRIGGER trigger_update_full_name
BEFORE INSERT OR UPDATE OF first_name, last_name ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.update_full_name_from_parts();

-- Add updated_at column and trigger for automatic updates
ALTER TABLE public.profiles
ADD COLUMN updated_at timestamp with time zone DEFAULT now();

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
```