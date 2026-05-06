// Unit factors normalized to a base unit mapping.
// Length: Base is meters (m)
const lengthUnits: Record<string, number> = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  km: 1000,
  in: 0.0254,
  inch: 0.0254,
  ft: 0.3048,
  foot: 0.3048,
  feet: 0.3048,
  yd: 0.9144,
  yard: 0.9144,
  mi: 1609.34,
  mile: 1609.34,
  miles: 1609.34
};

// Weight: Base is grams (g)
const weightUnits: Record<string, number> = {
  mg: 0.001,
  g: 1,
  kg: 1000,
  tonne: 1000000,
  oz: 28.3495,
  lb: 453.592,
  lbs: 453.592
};

// Volume: Base is liters (l)
const volumeUnits: Record<string, number> = {
  ml: 0.001,
  l: 1,
  liter: 1,
  liters: 1,
  tsp: 0.00492892,
  tbsp: 0.0147868,
  "fl oz": 0.0295735,
  cup: 0.236588,
  cups: 0.236588,
  pint: 0.473176,
  pints: 0.473176,
  quart: 0.946353,
  quarts: 0.946353,
  gal: 3.78541,
  gallon: 3.78541,
  gallons: 3.78541
};

// Speed: Base is meters per second (m/s)
const speedUnits: Record<string, number> = {
  "m/s": 1,
  "km/h": 0.277778,
  mph: 0.44704,
  knot: 0.514444,
  knots: 0.514444
};

// All multiplicative categories
const multiplicativeCategories = [lengthUnits, weightUnits, volumeUnits, speedUnits];

const COUNTERPART: Record<string, string> = {
  km: 'miles', m: 'feet', cm: 'inches', mm: 'inches',
  mile: 'km', miles: 'km', mi: 'km',
  ft: 'cm', foot: 'cm', feet: 'cm',
  in: 'cm', inch: 'cm', inches: 'cm',
  yd: 'm', yard: 'm',
  kg: 'lb', g: 'oz', tonne: 'lb',
  lb: 'kg', lbs: 'kg', oz: 'g',
  l: 'gal', liter: 'gal', liters: 'gal', ml: 'fl oz',
  gal: 'l', gallon: 'l', gallons: 'l',
  c: 'f', celsius: 'fahrenheit', '°c': '°f',
  f: 'c', fahrenheit: 'celsius', '°f': '°c',
  'km/h': 'mph', mph: 'km/h',
};

// Temperature conversions (non-linear)
function convertTemperature(value: number, from: string, to: string): number | null {
  const cTemp = ["c", "celsius", "°c"];
  const fTemp = ["f", "fahrenheit", "°f"];
  const kTemp = ["k", "kelvin", "°k"];

  const isFromC = cTemp.includes(from);
  const isFromF = fTemp.includes(from);
  const isFromK = kTemp.includes(from);

  const isToC = cTemp.includes(to);
  const isToF = fTemp.includes(to);
  const isToK = kTemp.includes(to);

  // Convert `from` into Celsius as base
  let inCelsius = 0;
  if (isFromC) {
    inCelsius = value;
  } else if (isFromF) {
    inCelsius = (value - 32) * 5/9;
  } else if (isFromK) {
    inCelsius = value - 273.15;
  } else {
    return null; // Not a temp match
  }

  // Convert from Celsius to `to`
  if (isToC) return inCelsius;
  if (isToF) return (inCelsius * 9/5) + 32;
  if (isToK) return inCelsius + 273.15;
  return null;
}

export function convertUnit(value: number, fromUnit: string, toUnit: string): string | null {
  const from = fromUnit.toLowerCase().trim();
  const to = toUnit.toLowerCase().trim();

  // 1. Try multiplicative categories
  for (const category of multiplicativeCategories) {
    if (from in category && to in category) {
      const fromFactor = category[from];
      const toFactor = category[to];
      
      const result = (value * fromFactor) / toFactor;
      return `${parseFloat(result.toPrecision(10))} ${toUnit.toLowerCase()}`;
    }
  }

  // 2. Try Temperature
  const tempResult = convertTemperature(value, from, to);
  if (tempResult !== null) {
      return `${parseFloat(tempResult.toPrecision(10))} ${toUnit.toLowerCase()}`;
  }

  return null;
}

/**
 * Convenience parser for regex strings
 * e.g., "100 km to miles" or "100 km"
 */
export function evaluateUnitExpression(expression: string): string | null {
  const explicit = expression.trim().match(/^([-+]?[0-9]*\.?[0-9]+)\s+([a-zA-Z°/\s]+?)\s+(?:to|in)\s+([a-zA-Z°/\s]+)$/i);
  if (explicit) {
    const value = parseFloat(explicit[1]);
    const fromUnit = explicit[2];
    const toUnit = explicit[3];
    return convertUnit(value, fromUnit, toUnit);
  }

  const implicit = expression.trim().match(/^([-+]?[0-9]*\.?[0-9]+)\s+([a-zA-Z°/]+)$/);
  if (implicit) {
    const value = parseFloat(implicit[1]);
    const fromUnit = implicit[2].toLowerCase();
    const target = COUNTERPART[fromUnit];
    if (target) return convertUnit(value, fromUnit, target);
  }

  return null;
}
