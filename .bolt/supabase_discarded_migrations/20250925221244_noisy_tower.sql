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
*/

-- Add new profile fields
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS first_name text,
ADD COLUMN IF NOT EXISTS last_name text,
ADD COLUMN IF NOT EXISTS phone_number text,
ADD COLUMN IF NOT EXISTS date_of_birth date,
ADD COLUMN IF NOT EXISTS nickname text,
ADD COLUMN IF NOT EXISTS country_code text,
ADD COLUMN IF NOT EXISTS country_name text;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_profiles_country_code ON profiles(country_code);
CREATE INDEX IF NOT EXISTS idx_profiles_phone_number ON profiles(phone_number);
CREATE INDEX IF NOT EXISTS idx_profiles_date_of_birth ON profiles(date_of_birth);

-- Add constraints
ALTER TABLE profiles 
ADD CONSTRAINT check_country_code_length
CHECK (country_code IS NULL OR length(country_code) = 2);

ALTER TABLE profiles 
ADD CONSTRAINT IF NOT EXISTS check_phone_number_format 
CHECK (phone_number IS NULL OR phone_number ~ '^\+[1-9]\d{1,14}$');

-- Update existing profiles to split full_name into first_name and last_name
DO $$
BEGIN
  UPDATE profiles 
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
END $$;