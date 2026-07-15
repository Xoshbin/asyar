#[derive(Default)]
pub struct LineBuffer {
    buffer: Vec<u8>,
}

impl LineBuffer {
    pub fn new() -> Self {
        Self { buffer: Vec::new() }
    }

    /// Feeds bytes into the buffer and yields complete lines.
    pub fn feed(&mut self, chunk: &[u8]) -> Vec<String> {
        self.buffer.extend_from_slice(chunk);
        let mut lines = Vec::new();
        let mut start = 0;

        while let Some(pos) = self.buffer[start..].iter().position(|&b| b == b'\n') {
            let newline_idx = start + pos;
            let mut line_bytes = &self.buffer[start..newline_idx];

            // Strip trailing carriage return if present
            if line_bytes.ends_with(b"\r") {
                line_bytes = &line_bytes[..line_bytes.len() - 1];
            }

            let line = String::from_utf8_lossy(line_bytes).into_owned();
            lines.push(line);
            start = newline_idx + 1;
        }

        if start > 0 {
            self.buffer.drain(0..start);
        }

        lines
    }

    /// Process any remaining bytes at the end of the stream as a line.
    pub fn flush(&mut self) -> Option<String> {
        if self.buffer.is_empty() {
            None
        } else {
            let mut line_bytes = &self.buffer[..];
            if line_bytes.ends_with(b"\r") {
                line_bytes = &line_bytes[..line_bytes.len() - 1];
            }
            let line = String::from_utf8_lossy(line_bytes).into_owned();
            self.buffer.clear();
            Some(line)
        }
    }
}
