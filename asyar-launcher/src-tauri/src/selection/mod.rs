pub mod error;
pub mod platform;
pub mod service;

pub use error::SelectionError;
pub use service::{get_selected_finder_items, get_selected_text};
