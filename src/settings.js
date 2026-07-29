const STORAGE_KEY = 'drak-brnensky.settings.v1';
const BASE_SENSITIVITY = 0.0022;

export const DEFAULT_SETTINGS = Object.freeze({
  sensitivity: 1,
  invertY: false,
  volume: 0.55,
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function normalizeSettings(value = {}) {
  const sensitivity = Number(value.sensitivity);
  const volume = Number(value.volume);
  return {
    sensitivity: clamp(
      Number.isFinite(sensitivity) ? sensitivity : DEFAULT_SETTINGS.sensitivity,
      0.5,
      2,
    ),
    invertY: value.invertY === true,
    volume: clamp(Number.isFinite(volume) ? volume : DEFAULT_SETTINGS.volume, 0, 1),
  };
}

export function loadSettings(storage = localStorage) {
  try {
    return normalizeSettings(JSON.parse(storage.getItem(STORAGE_KEY) || '{}'));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings, storage = localStorage) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(normalizeSettings(settings)));
    return true;
  } catch {
    return false;
  }
}

export function bindSettings(root, input, audio, storage = localStorage) {
  let settings = loadSettings(storage);
  const controls = [...root.querySelectorAll('[data-setting]')];
  const outputs = [...root.querySelectorAll('[data-setting-value]')];

  const apply = () => {
    input.sensitivity = BASE_SENSITIVITY * settings.sensitivity;
    input.invertY = settings.invertY;
    audio.setVolume(settings.volume);

    for (const control of controls) {
      const key = control.dataset.setting;
      if (control.type === 'checkbox') control.checked = settings[key];
      else control.value = settings[key];
    }
    for (const output of outputs) {
      const key = output.dataset.settingValue;
      const value = settings[key];
      output.textContent = `${Math.round(value * 100)} %`;
    }
  };

  const update = (event) => {
    const control = event.currentTarget;
    settings = normalizeSettings({
      ...settings,
      [control.dataset.setting]: control.type === 'checkbox'
        ? control.checked
        : Number(control.value),
    });
    saveSettings(settings, storage);
    apply();
  };

  for (const control of controls) {
    control.addEventListener(control.type === 'range' ? 'input' : 'change', update);
  }
  apply();

  return {
    get values() { return { ...settings }; },
  };
}
