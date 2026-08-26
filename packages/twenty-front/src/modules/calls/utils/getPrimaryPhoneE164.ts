// Normalizes a record's PHONES field to something Telnyx will accept.
// Bare 10-digit numbers are assumed North American — that is what every number
// imported from GHL looks like when the calling code did not survive the import.
export const getPrimaryPhoneE164 = (
  phones:
    | {
        primaryPhoneNumber?: string | null;
        primaryPhoneCallingCode?: string | null;
      }
    | null
    | undefined,
): string => {
  const primaryPhoneNumber = phones?.primaryPhoneNumber;

  if (!primaryPhoneNumber) {
    return '';
  }

  const callingCode = phones?.primaryPhoneCallingCode ?? '';

  if (callingCode) {
    return `${callingCode}${primaryPhoneNumber}`;
  }

  const digits = primaryPhoneNumber.replace(/\D/g, '');

  return digits.length === 10 ? `+1${digits}` : primaryPhoneNumber;
};
