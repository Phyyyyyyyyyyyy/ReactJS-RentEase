/**
 * Server-side form validation.
 *
 *   const form = new Form(req.body);
 *   const name = form.text('name', { max: 150 });
 *   const rent = form.money('monthly_rent');
 *   if (form.valid && rent <= 0) form.error('monthly_rent', 'Monthly rent must be greater than zero.');
 *   form.check(); // throws a 400 with { message, errors: { field: [...] } } if anything failed
 *
 * Each field method returns the cleaned value and records an error if the
 * value is missing or invalid. Messages match the ones the app showed before.
 */
import { formErrors } from './http.js';
import { isValidDate } from './format.js';

const REQUIRED = 'This field is required.';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@.]+$/;

export class Form {
  constructor(data = {}, files = {}) {
    this.data = data;
    this.files = files;
    this.errors = {};
  }

  get valid() {
    return Object.keys(this.errors).length === 0;
  }

  /** True when `field` has no error so far (so a later check can rely on its value). */
  ok(field) {
    return !this.errors[field];
  }

  error(field, message) {
    (this.errors[field] ||= []).push(message);
  }

  /** Form-wide error, shown at the top of the form. */
  formError(message) {
    this.error('non_field_errors', message);
  }

  check(message) {
    if (!this.valid) throw formErrors(this.errors, message);
  }

  raw(field) {
    const value = this.data[field];
    if (value === undefined || value === null) return '';
    return typeof value === 'string' ? value : String(value);
  }

  has(field) {
    return this.data[field] !== undefined;
  }

  /** Text. Surrounding spaces are removed (unless strip: false). */
  text(field, { required = true, max, strip = true } = {}) {
    let value = this.raw(field);
    if (strip) value = value.trim();
    if (!value) {
      if (required) this.error(field, REQUIRED);
      return '';
    }
    if (max && value.length > max) {
      this.error(field, `Ensure this value has at most ${max} characters (it has ${value.length}).`);
    }
    return value;
  }

  email(field, { required = true } = {}) {
    const value = this.text(field, { required, max: 254 });
    if (value && this.ok(field) && !EMAIL_RE.test(value)) this.error(field, 'Enter a valid email address.');
    return value.toLowerCase();
  }

  /** One of `choices`: an array of [value, label] pairs. */
  choice(field, choices, { required = true } = {}) {
    const value = this.text(field, { required });
    if (value && !choices.some(([v]) => v === value)) {
      this.error(field, `Select a valid choice. ${value} is not one of the available choices.`);
    }
    return value;
  }

  integer(field, { required = true, min, max } = {}) {
    const value = this.text(field, { required });
    if (!value) return null;
    if (!/^[+-]?\d+(\.0*)?$/.test(value)) {
      this.error(field, 'Enter a whole number.');
      return null;
    }
    const n = parseInt(value, 10);
    if (min !== undefined && n < min) this.error(field, `Ensure this value is greater than or equal to ${min}.`);
    if (max !== undefined && n > max) this.error(field, `Ensure this value is less than or equal to ${max}.`);
    return n;
  }

  /** An amount of money in pesos (up to 99,999,999.99), returned as whole centavos. */
  money(field, { required = true, min } = {}) {
    const value = this.text(field, { required });
    if (!value) return null;
    const match = /^\+?(\d*)(?:\.(\d*))?$/.exec(value);
    if (!match || (!match[1] && !match[2])) {
      if (/^-\d*(\.\d*)?$/.test(value) && min !== undefined) {
        this.error(field, `Ensure this value is greater than or equal to ${min}.`);
      } else {
        this.error(field, 'Enter a number.');
      }
      return null;
    }
    const whole = match[1].replace(/^0+(?=\d)/, '') || '0';
    const fraction = match[2] || '';
    if (fraction.length > 2) {
      this.error(field, 'Ensure that there are no more than 2 decimal places.');
      return null;
    }
    if (whole.length > 8) {
      this.error(field, 'Ensure that there are no more than 8 digits before the decimal point.');
      return null;
    }
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (min !== undefined && cents < min * 100) {
      this.error(field, `Ensure this value is greater than or equal to ${min}.`);
    }
    return cents;
  }

  /** A date as YYYY-MM-DD, or null when left empty (and not required). */
  date(field, { required = true } = {}) {
    const value = this.text(field, { required });
    if (!value) return null;
    if (!isValidDate(value)) {
      this.error(field, 'Enter a valid date.');
      return null;
    }
    return value;
  }

  /** An uploaded file (from multipart/form-data), or null. */
  file(field) {
    const file = this.files[field];
    return file && file.size > 0 ? file : null;
  }
}
