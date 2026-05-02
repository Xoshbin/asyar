use windows::Win32::System::DataExchange::GetClipboardFormatNameW;
use windows::Win32::System::Ole::{OleGetClipboard, OleInitialize};
use windows::Win32::System::Com::{IDataObject, IEnumFORMATETC, FORMATETC, DATADIR_GET};

/// Read the current Windows clipboard's registered format names.
///
/// Standard formats below `0xC000` (CF_TEXT, CF_UNICODETEXT, etc.) have no
/// system-registered name; we ignore them and return only registered format
/// names like `CanIncludeInClipboardHistory` and
/// `ExcludeClipboardContentFromMonitorProcessing` that the classifier
/// recognises.
pub fn read_pasteboard_types() -> Vec<String> {
    let mut out = Vec::new();
    unsafe {
        // OleInitialize is idempotent per-thread.
        let _ = OleInitialize(None);

        let data: IDataObject = match OleGetClipboard() {
            Ok(d) => d,
            Err(_) => return out,
        };

        let enumerator: IEnumFORMATETC = match data.EnumFormatEtc(DATADIR_GET.0 as u32) {
            Ok(e) => e,
            Err(_) => return out,
        };

        loop {
            let mut formats = [FORMATETC::default(); 1];
            let mut fetched = 0u32;
            if enumerator
                .Next(&mut formats, Some(&mut fetched))
                .is_err()
                || fetched == 0
            {
                break;
            }
            let cf = formats[0].cfFormat as u32;

            if cf >= 0xC000 {
                let mut buf = [0u16; 256];
                let len = GetClipboardFormatNameW(cf, &mut buf);
                if len > 0 {
                    out.push(String::from_utf16_lossy(&buf[..len as usize]));
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "interacts with the system clipboard; run manually with --ignored on Windows"]
    fn read_pasteboard_types_does_not_panic_on_empty_clipboard() {
        let _ = read_pasteboard_types();
    }
}
