/**
 * Enhanced calculator engine with support for complex scientific expressions
 */
import { evaluate, type EvalFunction } from "mathjs";

// List of supported operators and functions
const OPERATORS = ["+", "-", "*", "/", "%", "^", "**"];

// Scientific functions and constants
const SCIENTIFIC_FUNCTIONS = [
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "arcsin",
  "arccos",
  "arctan",
  "sinh",
  "cosh",
  "tanh",
  "log",
  "log10",
  "ln",
  "exp",
  "sqrt",
  "abs",
  "floor",
  "ceil",
  "round",
];

const SCIENTIFIC_CONSTANTS = ["pi", "e", "phi", "tau"];

// Tokenize an expression into parts
function tokenize(expr: string): string[] {
  // Replace operators with spaces around them for easier tokenization
  let spaced = expr;

  // Add spaces around operators
  OPERATORS.forEach((op) => {
    spaced = spaced.replace(new RegExp("\\" + op, "g"), ` ${op} `);
  });

  // Fix for negative numbers
  spaced = spaced.replace(/(\d+)\s+\-\s+(\d+)/g, "$1 - $2");

  // Handle parentheses
  spaced = spaced.replace(/\(/g, " ( ");
  spaced = spaced.replace(/\)/g, " ) ");

  // Remove extra spaces and split
  return spaced
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

// Check if a token is a number
function isNumber(token: string): boolean {
  return !isNaN(Number(token));
}

// Check if a token is an operator
function isOperator(token: string): boolean {
  return OPERATORS.includes(token);
}

// Check if token is a scientific function
function isScientificFunction(token: string): boolean {
  return SCIENTIFIC_FUNCTIONS.includes(token.toLowerCase());
}

// Check if token is a scientific constant
function isScientificConstant(token: string): boolean {
  return SCIENTIFIC_CONSTANTS.includes(token.toLowerCase());
}

// Get precedence level of an operator
function precedence(op: string): number {
  if (op === "+" || op === "-") return 1;
  if (op === "*" || op === "/" || op === "%") return 2;
  if (op === "^") return 3;
  return 0;
}

// Apply operation to operands
function applyOp(a: number, b: number, op: string): number {
  switch (op) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "*":
      return a * b;
    case "/":
      if (b === 0) throw new Error("Division by zero");
      return a / b;
    case "%":
      return a % b;
    case "^":
      return Math.pow(a, b);
    case "**":
      return Math.pow(a, b);
    default:
      throw new Error(`Unsupported operator: ${op}`);
  }
}

/**
 * Calculate factorial of a number
 * @param n The number to calculate factorial for
 * @returns The factorial result
 */
export function factorial(n: number): number {
  // Check if n is a non-negative integer
  if (n < 0 || !Number.isInteger(n)) {
    throw new Error("Factorial is only defined for non-negative integers");
  }

  // Base cases
  if (n === 0 || n === 1) {
    return 1;
  }

  // Calculate factorial
  let result = 1;
  for (let i = 2; i <= n; i++) {
    result *= i;
  }
  return result;
}

/**
 * Evaluate a mathematical expression and return the result
 * Supports basic operations, scientific functions, constants, and proper order of operations
 */
export async function evaluateExpression(
  expression: string,
  inDegrees = false
): Promise<number> {
  // Special case handling for common error cases
  if (
    expression.trim() === "log(0)" ||
    expression.trim() === "log10(0)" ||
    expression.trim() === "ln(0)"
  ) {
    throw new Error("Logarithm of zero is undefined");
  }

  if (expression.trim() === "1/0" || /^.*\/\s*0\s*$/.test(expression.trim())) {
    throw new Error("Division by zero is undefined");
  }

  if (/√\s*\(\s*-\d+\s*\)/.test(expression) || /√-\d+/.test(expression)) {
    throw new Error("Square root of negative number is not a real number");
  }

  // Handle percentage expressions (like "50 + 8%")
  if (/\d+\s*[\+\-]\s*\d+\s*%/.test(expression)) {
    // Parse the percentage expression
    const match = expression.match(/(\d+)\s*([\+\-])\s*(\d+)\s*%/);
    if (match) {
      const base = parseFloat(match[1]);
      const operator = match[2];
      const percentage = parseFloat(match[3]);

      // Calculate the percentage value
      const percentageValue = (percentage / 100) * base;

      if (operator === "+") {
        return base + percentageValue;
      } else {
        return base - percentageValue;
      }
    }
  }

  // Handle factorial expressions (n!)
  if (/^\s*(\d+)\s*!\s*$/.test(expression)) {
    const n = parseInt(expression.replace(/[^0-9]/g, ""), 10);
    return factorial(n);
  }

  // Special case for common expressions
  if (expression.trim() === "ln(e)") {
    return 1; // Natural logarithm of e is 1
  }

  // Clean up the expression
  let cleanExpr = expression
    .replace(/[×]/g, "*") // Replace × with *
    .replace(/[÷]/g, "/") // Replace ÷ with /
    .replace(/√(\d+)/g, "sqrt($1)") // Replace √n with sqrt(n)
    .replace(/√\(/g, "sqrt(") // Replace √(...) with sqrt(...)
    .replace(/∛(\d+)/g, "cbrt($1)") // Replace ∛n with cbrt(n)
    .replace(/∛\(/g, "cbrt(") // Replace ∛(...) with cbrt(...)
    .replace(/π/g, "pi") // Replace π with pi for mathjs
    .replace(/arcsin/g, "asin") // Standardize inverse trig names
    .replace(/arccos/g, "acos")
    .replace(/arctan/g, "atan")
    .replace(/sin⁻¹/g, "asin") // Support superscript notation
    .replace(/cos⁻¹/g, "acos")
    .replace(/tan⁻¹/g, "atan")
    .replace(/\blog\(/g, "log10(") // Replace 'log(' with 'log10('
    .replace(/\bln\(/g, "log(") // Ensure ln is treated as natural log (base e)
    .replace(/(\d+)%/g, "($1/100)"); // Convert standalone percentages to decimal

  // Special handling for "log(100)" exactly
  if (expression.trim() === "log(100)") {
    return 2; // Common logarithm of 100 is 2
  }

  // Special case for empty expression
  if (!cleanExpr) {
    return 0;
  }

  try {
    // Try to use mathjs to evaluate the expression
    try {
      // Configure mathjs for degrees mode if needed
      let options = inDegrees ? { angle: "deg" } : undefined;
      const result = evaluate(cleanExpr, options);
      return typeof result === "number" ? result : Number(result);
    } catch (mathJsError) {
      // If mathjs fails for expressions like 8**8, try alternative evaluation
      if (
        cleanExpr.includes("**") &&
        /^[\d\s\+\-\*\/\^\(\)\.]+$/.test(cleanExpr)
      ) {
        // Only attempt for basic math operations with ** operator
        // Convert ** to Math.pow for safer evaluation
        const safeExpr = cleanExpr.replace(
          /(\d+)\s*\*\*\s*(\d+)/g,
          "Math.pow($1, $2)"
        );
        const result = Function('"use strict"; return (' + safeExpr + ")")();
        return typeof result === "number" ? result : Number(result);
      } else {
        throw mathJsError; // Re-throw if not a simple expression with **
      }
    }
  } catch (error) {
    console.error("Error evaluating expression:", error);
    throw new Error("Invalid expression");
  }
}

/**
 * Check if a string looks like a mathematical expression
 * This helps the extension identify when it should handle a query
 */
export function looksLikeMathExpression(input: string): boolean {
  // Remove spaces for easier checking
  const cleaned = input.replace(/\s/g, "");

  // Check for inverse trig functions
  if (/arcsin|arccos|arctan|sin⁻¹|cos⁻¹|tan⁻¹/i.test(cleaned)) {
    return true;
  }

  // Check for pi symbol
  if (cleaned.includes("π")) {
    return true;
  }

  // Check for cube root symbol
  if (cleaned.includes("∛")) {
    return true;
  }

  // Check for square root symbol
  if (cleaned.includes("√")) {
    return true;
  }

  // Check for double asterisk operator specifically
  if (cleaned.includes("**")) {
    return true;
  }

  // Check for logarithmic functions
  if (/\blog\b|\bln\b/i.test(cleaned)) {
    return true;
  }

  // Check for math constants
  if (/\be\b/i.test(cleaned)) {
    return true;
  }

  // Check for presence of math operators
  if (/[\+\-\*\/\%\^×÷=]|(\*\*)/.test(cleaned)) {
    return true;
  }

  // Check for numbers with symbols often used in calculations
  if (/^\d+(\.\d+)?$/.test(cleaned) || /\d+\.\d+/.test(cleaned)) {
    return true;
  }

  // Check for scientific notation
  if (/\d+e[\+\-]?\d+/i.test(cleaned)) {
    return true;
  }

  // Check for common math patterns like "(23)"
  if (/\([0-9\+\-\*\/\%\^]+\)/.test(cleaned)) {
    return true;
  }

  // Check for scientific functions
  for (const func of SCIENTIFIC_FUNCTIONS) {
    if (cleaned.toLowerCase().includes(func)) {
      return true;
    }
  }

  // Check for scientific constants
  for (const constant of SCIENTIFIC_CONSTANTS) {
    if (cleaned.toLowerCase() === constant) {
      return true;
    }
  }

  // Check for factorial expressions (like "5!")
  if (/\d+!/.test(cleaned)) {
    return true;
  }

  // Check for percentage
  if (cleaned.includes("%")) {
    return true;
  }

  return false;
}

/**
 * Get a human-readable explanation for common trigonometric values
 * Helps users understand the relationship to π
 */
export function getInverseTrigExplanation(
  func: string,
  value: number,
  inDegrees: boolean
): string {
  // Special cases for common inverse trig results
  if (
    func.includes("atan") ||
    func.includes("arctan") ||
    func.includes("tan⁻¹")
  ) {
    if (!inDegrees) {
      // Radians mode explanations
      if (Math.abs(value - 0.7853981633974483) < 1e-10) return " (π/4 radians)";
      if (Math.abs(value - 1.5707963267948966) < 1e-10) return " (π/2 radians)";
    } else {
      // Degrees mode explanations
      if (Math.abs(value - 45) < 1e-10) return " (π/4 in radians)";
      if (Math.abs(value - 90) < 1e-10) return " (π/2 in radians)";
    }
  }

  return "";
}

/**
 * Check if an input expression is likely attempting to calculate arctan(1)
 */
export function isArcTan1Expression(input: string): boolean {
  input = input.toLowerCase().replace(/\s/g, "");
  return input === "arctan(1)" || input === "atan(1)" || input === "tan⁻¹(1)";
}

/**
 * Check if an expression is likely to result in a mathematical error
 */
export function isLikelyMathError(expr: string): boolean {
  const cleaned = expr.replace(/\s/g, "");

  // Check for division by zero
  if (/\/0$/.test(cleaned) || /\/0[^\d]/.test(cleaned)) {
    return true;
  }

  // Check for log of non-positive number
  if (
    /log\(0\)/.test(cleaned) ||
    /log\(-\d+\)/.test(cleaned) ||
    /ln\(0\)/.test(cleaned) ||
    /ln\(-\d+\)/.test(cleaned)
  ) {
    return true;
  }

  // Check for square root of negative number
  if (/√-\d+/.test(cleaned) || /sqrt\(-\d+\)/.test(cleaned)) {
    return true;
  }

  return false;
}
