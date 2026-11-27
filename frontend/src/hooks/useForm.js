import { useCallback, useRef, useState } from 'react';
import { useFlash } from '../context/FlashContext';

/**
 * Form state with server-side validation.
 *
 * The API validates every form on the server and answers 400
 * with { message, errors: { field: [..], non_field_errors: [..] } }. Field errors
 * show under each field; "Please fix the errors below." shows at the top.
 */
export function useForm(initial) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const { notify } = useFlash();

  const setValue = useCallback((name, value) => setValues((v) => ({ ...v, [name]: value })), []);

  /** Props for a text input, select, or textarea: <input {...bind('name')} /> */
  const bind = (name) => ({
    name,
    value: values[name] ?? '',
    onChange: (e) => setValue(name, e.target.value),
  });

  /** Props for a file input. The chosen File goes into values[name]. */
  const bindFile = (name) => ({
    name,
    type: 'file',
    onChange: (e) => setValue(name, e.target.files[0] || null),
  });

  /** Run `action(values)`. Resolves to its result, or undefined if it failed. */
  const submit = async (action) => {
    // Ignore a second submit (double click / Enter twice) while the first is still saving.
    if (inFlight.current) return undefined;
    inFlight.current = true;
    setBusy(true);
    setErrors({});
    try {
      return await action(values);
    } catch (error) {
      const fieldErrors = error.data?.errors;
      if (fieldErrors) {
        setErrors(fieldErrors);
        // Field problems get a banner at the top; a form-level error alone shows inside the form.
        if (Object.keys(fieldErrors).some((k) => k !== 'non_field_errors')) notify('error', error.message);
      } else {
        notify('error', error.message);
      }
      return undefined;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return { values, setValues, setValue, errors, setErrors, busy, bind, bindFile, submit };
}
