/*
  # Enhanced Profile Fields Migration

  1. New Columns Added
    - `first_name` (text) - User's first name
    - `last_name` (text) - User's last name  
    - `phone_number` (text) - User's phone number with country code
    - `date_of_birth` (date) - User's date of birth
    - `nickname` (text) - User's preferred nickname/display name
    - `country_code` (text) - ISO country code (e.g., 'US', 'CA', 'GB')
    - `country_name` (text) - Full country name (e.g., 'United States')

  2. Data Migration
    - Split existing full_name into first_name and last_name where possible
    - Keep full_name for backward compatibility

  3. Indexes
    - Add index on country_code for efficient filtering
    - Add index on phone_number for uniqueness checks

  4. Constraints
    - Phone number format validation (E.164 format)
    - Country code format validation (2-letter ISO codes)
    - Date of birth range validation (1900 to current date)
*/

-- Add new columns to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS first_name text,
ADD COLUMN IF NOT EXISTS last_name text,
ADD COLUMN IF NOT EXISTS phone_number text,
ADD COLUMN IF NOT EXISTS date_of_birth date,
ADD COLUMN IF NOT EXISTS nickname text,
ADD COLUMN IF NOT EXISTS country_code text,
ADD COLUMN IF NOT EXISTS country_name text;

-- Add constraints (FIXED: Removed IF NOT EXISTS from ALTER TABLE ADD CONSTRAINT)
ALTER TABLE public.profiles 
ADD CONSTRAINT check_country_code_length 
CHECK (country_code IS NULL OR length(country_code) = 2);

ALTER TABLE public.profiles 
ADD CONSTRAINT check_phone_number_format 
CHECK (phone_number IS NULL OR phone_number ~ '^\\+[1-9]\\d{1,14}$');

ALTER TABLE public.profiles 
ADD CONSTRAINT profiles_date_of_birth_range 
CHECK (date_of_birth IS NULL OR (date_of_birth >= '1900-01-01' AND date_of_birth <= CURRENT_DATE));

ALTER TABLE public.profiles 
ADD CONSTRAINT profiles_country_code_format 
CHECK (country_code IS NULL OR (length(country_code) = 2 AND country_code ~ '^[A-Z]{2}$'));

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_profiles_first_name ON public.profiles(first_name);
CREATE INDEX IF NOT EXISTS idx_profiles_last_name ON public.profiles(last_name);
CREATE INDEX IF NOT EXISTS idx_profiles_phone_number ON public.profiles(phone_number);
CREATE INDEX IF NOT EXISTS idx_profiles_country_code ON public.profiles(country_code);
CREATE INDEX IF NOT EXISTS idx_profiles_user_preferences ON public.profiles USING gin(user_preferences);

-- Create function to automatically update full_name when first_name or last_name changes
CREATE OR REPLACE FUNCTION update_full_name_from_parts()
RETURNS TRIGGER AS $$
BEGIN
  -- Update full_name based on first_name and last_name
  IF NEW.first_name IS NOT NULL AND NEW.last_name IS NOT NULL THEN
    NEW.full_name := NEW.first_name || ' ' || NEW.last_name;
  ELSIF NEW.first_name IS NOT NULL THEN
    NEW.full_name := NEW.first_name;
  ELSIF NEW.last_name IS NOT NULL THEN
    NEW.full_name := NEW.last_name;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update full_name
DROP TRIGGER IF EXISTS trigger_update_full_name ON public.profiles;
CREATE TRIGGER trigger_update_full_name
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_full_name_from_parts();

-- Migrate existing full_name data to first_name and last_name
UPDATE public.profiles 
SET 
  first_name = CASE 
    WHEN full_name IS NOT NULL AND position(' ' in full_name) > 0 
    THEN split_part(full_name, ' ', 1)
    ELSE full_name
  END,
  last_name = CASE 
    WHEN full_name IS NOT NULL AND position(' ' in full_name) > 0 
    THEN substring(full_name from position(' ' in full_name) + 1)
    ELSE NULL
  END
WHERE full_name IS NOT NULL 
  AND (first_name IS NULL OR last_name IS NULL);