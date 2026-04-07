pub mod error;
pub mod service;
pub mod platform;

pub use error::SelectionError;
pub use service::{get_selected_text, get_selected_finder_items};
