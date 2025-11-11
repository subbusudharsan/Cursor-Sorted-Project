export const PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

export const PASSWORD_RULE_DESCRIPTION =
  'Password must be 8+ characters and include an uppercase letter, a number, and a special symbol (@ $ ! % * ? &).';

export const isStrongPassword = (value: string): boolean => {
  if (typeof value !== 'string') return false;
  return PASSWORD_REGEX.test(value);
};

export const getPasswordErrors = (value: string): string[] => {
  if (!value) {
    return ['Password is required.'];
  }

  const errors: string[] = [];
  if (value.length < 8) {
    errors.push('Use at least 8 characters.');
  }
  if (!/[A-Z]/.test(value)) {
    errors.push('Add at least one uppercase letter.');
  }
  if (!/\d/.test(value)) {
    errors.push('Add at least one number.');
  }
  if (!/[@$!%*?&]/.test(value)) {
    errors.push('Add a special symbol (@ $ ! % * ? &).');
  }

  return errors;
};

