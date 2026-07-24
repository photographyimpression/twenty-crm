import Cookies from 'js-cookie';

// A cookie written WITHOUT `expires` is a session cookie: the browser deletes
// it when it fully quits, logging the user out even though the server tokens
// are valid for months. Any cookie meant to survive a browser restart must
// pass this expiry.
export const PERSISTENT_COOKIE_EXPIRES_DAYS = 180;

export const getPersistentCookieExpires = (): Date =>
  new Date(Date.now() + 1000 * 60 * 60 * 24 * PERSISTENT_COOKIE_EXPIRES_DAYS);

class CookieStorage {
  private keys: Set<string> = new Set();

  getItem(key: string): string | undefined {
    return Cookies.get(key);
  }

  setItem(
    key: string,
    value: string,
    attributes?: Cookies.CookieAttributes,
  ): void {
    this.keys.add(key);

    const secureAttributes = {
      secure: window.location.protocol === 'https:',
      sameSite: 'lax' as const,
      ...attributes,
    };

    Cookies.set(key, value, secureAttributes);
  }

  removeItem(key: string, attributes?: Cookies.CookieAttributes): void {
    this.keys.delete(key);
    Cookies.remove(key, attributes);
  }

  clear(): void {
    this.keys.forEach((key) => this.removeItem(key));
  }
}

export const cookieStorage = new CookieStorage();
