//! Ingredient conversions between volume and weight using a density
//! table: `1 tablespoon of honey in grams`, `250 g of flour in cups`.

use regex::Regex;
use std::sync::OnceLock;

use super::format::format_number;
use super::{CalcKind, CalcResult};

/// Volume unit → (millilitres, singular label, plural label).
fn volume_unit(token: &str) -> Option<(f64, &'static str, &'static str)> {
    match token {
        "tsp" | "teaspoon" | "teaspoons" => Some((4.92892, "tsp", "tsp")),
        "tbsp" | "tablespoon" | "tablespoons" => Some((14.7868, "tbsp", "tbsp")),
        "cup" | "cups" => Some((236.588, "cup", "cups")),
        "ml" | "milliliter" | "milliliters" | "millilitre" | "millilitres" => {
            Some((1.0, "ml", "ml"))
        }
        "l" | "liter" | "liters" | "litre" | "litres" => Some((1000.0, "l", "l")),
        _ => None,
    }
}

/// Weight unit → (grams, label).
fn weight_unit(token: &str) -> Option<(f64, &'static str)> {
    match token {
        "g" | "gram" | "grams" => Some((1.0, "g")),
        "kg" | "kilogram" | "kilograms" => Some((1000.0, "kg")),
        "oz" | "ounce" | "ounces" => Some((28.3495, "oz")),
        "lb" | "lbs" | "pound" | "pounds" => Some((453.592, "lb")),
        _ => None,
    }
}

/// Common kitchen ingredient densities in g/ml.
fn density(ingredient: &str) -> Option<f64> {
    let d = match ingredient {
        "water" => 1.0,
        "milk" => 1.03,
        "honey" => 1.42,
        "flour" | "all purpose flour" | "all-purpose flour" | "plain flour" => 0.5283,
        "sugar" | "granulated sugar" => 0.8454,
        "brown sugar" => 0.93,
        "powdered sugar" | "icing sugar" => 0.56,
        "butter" => 0.9586,
        "oil" | "olive oil" | "vegetable oil" | "sunflower oil" => 0.92,
        "rice" => 0.85,
        "salt" => 1.217,
        "cocoa" | "cocoa powder" => 0.52,
        "oats" | "rolled oats" => 0.41,
        "syrup" | "maple syrup" => 1.32,
        "cream" => 1.01,
        "yogurt" | "yoghurt" => 1.03,
        "peanut butter" => 1.09,
        _ => return None,
    };
    Some(d)
}

/// Kitchen-friendly rounding: 1 decimal for large values, 2 for small.
fn round_kitchen(v: f64) -> f64 {
    if v.abs() >= 10.0 {
        (v * 10.0).round() / 10.0
    } else {
        (v * 100.0).round() / 100.0
    }
}

fn cooking_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"(?i)^(\d+(?:\.\d+)?)\s*([a-z]+)\s+of\s+([a-z][a-z\- ]*?)\s+(?:in|to|as)\s+([a-z]+)$",
        )
        .unwrap()
    })
}

/// Convert `<amount> <volume-unit> of <ingredient> to <weight-unit>` and
/// the reverse direction. Returns `None` for unknown ingredients.
pub fn evaluate_cooking(query: &str) -> Option<CalcResult> {
    let c = cooking_re().captures(query.trim())?;
    let amount: f64 = c[1].parse().ok()?;
    let from = c[2].to_lowercase();
    let ingredient = c[3].to_lowercase().trim().to_string();
    let to = c[4].to_lowercase();
    let rho = density(&ingredient)?;

    // volume of X in weight
    if let (Some((ml, _, _)), Some((g_per, label))) = (volume_unit(&from), weight_unit(&to)) {
        let value = round_kitchen(amount * ml * rho / g_per);
        return Some(CalcResult::new(
            format!("{} {label}", format_number(value)),
            format!("{ingredient} ≈ {rho} g/ml"),
            CalcKind::Unit,
        ));
    }

    // weight of X in volume
    if let (Some((g_per, _)), Some((ml, singular, plural))) = (weight_unit(&from), volume_unit(&to))
    {
        let value = round_kitchen(amount * g_per / rho / ml);
        let label = if value == 1.0 { singular } else { plural };
        return Some(CalcResult::new(
            format!("{} {label}", format_number(value)),
            format!("{ingredient} ≈ {rho} g/ml"),
            CalcKind::Unit,
        ));
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::calculator::CalcKind;

    #[test]
    fn tablespoon_of_honey_in_grams() {
        let r = evaluate_cooking("1 tablespoon of honey in grams").unwrap();
        assert_eq!(r.value, "21 g");
        assert_eq!(r.kind, CalcKind::Unit);
        assert!(r.detail.contains("honey"), "detail: {}", r.detail);
    }

    #[test]
    fn cups_of_flour_to_grams() {
        assert_eq!(
            evaluate_cooking("2.5 cups of flour to grams")
                .unwrap()
                .value,
            "312.5 g"
        );
        assert_eq!(
            evaluate_cooking("1 cup of sugar in grams").unwrap().value,
            "200 g"
        );
    }

    #[test]
    fn weight_back_to_volume() {
        assert_eq!(
            evaluate_cooking("250 g of flour in cups").unwrap().value,
            "2 cups"
        );
        assert_eq!(
            evaluate_cooking("125 g of flour in cups").unwrap().value,
            "1 cup"
        );
    }

    #[test]
    fn kilograms_and_ounces() {
        assert_eq!(
            evaluate_cooking("2 cups of water in kg").unwrap().value,
            "0.47 kg"
        );
    }

    #[test]
    fn rejects_unknown_ingredients_and_other_queries() {
        assert!(evaluate_cooking("1 cup of unicorn to grams").is_none());
        assert!(evaluate_cooking("2+2").is_none());
        assert!(evaluate_cooking("100 usd to eur").is_none());
    }
}
