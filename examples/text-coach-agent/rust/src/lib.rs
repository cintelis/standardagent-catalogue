//! Text statistics for the Text Coach sample agent.
//!
//! The file has two parts:
//!
//! 1. Plain Rust: [`analyze`] takes a `&str` and returns [`Stats`]. It knows
//!    nothing about WebAssembly, so `cargo test` runs it natively.
//! 2. The `ffi` module at the bottom: three exported functions that let
//!    JavaScript pass a string in and read a JSON string out.
//!
//! The statistics are simple heuristics for English prose. They are good enough
//! to coach a writer, and they are not a linguistic analysis.

/// Average adult silent reading speed, in words per minute.
const WORDS_PER_MINUTE: f64 = 238.0;

/// What [`analyze`] measures.
#[derive(Debug, Clone, PartialEq)]
pub struct Stats {
    /// Unicode characters, including spaces and punctuation.
    pub characters: usize,
    pub words: usize,
    pub sentences: usize,
    pub paragraphs: usize,
    /// Estimated syllables across all words.
    pub syllables: usize,
    /// Word count of the longest sentence.
    pub longest_sentence_words: usize,
    pub reading_time_seconds: u64,
    /// `None` when the text has no words, because the formulas divide by the
    /// word and sentence counts.
    pub average_words_per_sentence: Option<f64>,
    /// Flesch Reading Ease. Higher is easier; 60 to 70 is plain English.
    pub flesch_reading_ease: Option<f64>,
    /// Flesch-Kincaid Grade Level: the US school grade that can read the text.
    pub flesch_kincaid_grade: Option<f64>,
}

/// Measures `text`.
pub fn analyze(text: &str) -> Stats {
    let mut words = 0;
    let mut sentences = 0;
    let mut paragraphs = 0;
    let mut syllables = 0;
    let mut longest_sentence_words = 0;

    // Words seen since the last sentence ended.
    let mut words_in_sentence = 0;
    let mut in_paragraph = false;

    for line in text.lines() {
        let mut line_has_word = false;

        for token in line.split_whitespace() {
            // "mat." becomes "mat"; a token of only punctuation becomes "".
            let word = token.trim_matches(|c: char| !c.is_alphanumeric());
            if word.is_empty() {
                continue;
            }
            line_has_word = true;
            words += 1;
            words_in_sentence += 1;
            syllables += count_syllables(word);

            if ends_sentence(token) {
                sentences += 1;
                longest_sentence_words = longest_sentence_words.max(words_in_sentence);
                words_in_sentence = 0;
            }
        }

        if line.trim().is_empty() {
            // A blank line ends the paragraph, and it ends a sentence that has
            // no closing punctuation, such as a heading.
            in_paragraph = false;
            if words_in_sentence > 0 {
                sentences += 1;
                longest_sentence_words = longest_sentence_words.max(words_in_sentence);
                words_in_sentence = 0;
            }
        } else if line_has_word && !in_paragraph {
            paragraphs += 1;
            in_paragraph = true;
        }
    }

    // Text that stops without closing punctuation still ends a sentence.
    if words_in_sentence > 0 {
        sentences += 1;
        longest_sentence_words = longest_sentence_words.max(words_in_sentence);
    }

    let (average_words_per_sentence, flesch_reading_ease, flesch_kincaid_grade) = if words == 0 {
        (None, None, None)
    } else {
        let words_per_sentence = words as f64 / sentences as f64;
        let syllables_per_word = syllables as f64 / words as f64;
        (
            Some(words_per_sentence),
            Some(206.835 - 1.015 * words_per_sentence - 84.6 * syllables_per_word),
            Some(0.39 * words_per_sentence + 11.8 * syllables_per_word - 15.59),
        )
    };

    Stats {
        characters: text.chars().count(),
        words,
        sentences,
        paragraphs,
        syllables,
        longest_sentence_words,
        reading_time_seconds: (words as f64 / WORDS_PER_MINUTE * 60.0).ceil() as u64,
        average_words_per_sentence,
        flesch_reading_ease,
        flesch_kincaid_grade,
    }
}

/// True when a whitespace-separated token closes a sentence: it ends with
/// `.`, `!`, `?`, or `…`, optionally followed by closing quotes or brackets.
///
/// "3.14" does not end a sentence, because the full stop is inside the token.
/// An abbreviation such as "e.g." does, which over-counts sentences slightly.
fn ends_sentence(token: &str) -> bool {
    let trimmed = token.trim_end_matches(['"', '\'', '”', '’', ')', ']', '}']);
    trimmed.ends_with(['.', '!', '?', '…'])
}

/// Estimates the syllables in one English word by counting groups of vowels.
///
/// A word without ASCII letters, such as a number, counts as one syllable.
fn count_syllables(word: &str) -> usize {
    let letters: Vec<char> = word
        .chars()
        .filter(char::is_ascii_alphabetic)
        .map(|c| c.to_ascii_lowercase())
        .collect();
    if letters.is_empty() {
        return 1;
    }

    let is_vowel = |c: char| matches!(c, 'a' | 'e' | 'i' | 'o' | 'u' | 'y');

    let mut groups = 0;
    let mut previous_was_vowel = false;
    for &letter in &letters {
        let vowel = is_vowel(letter);
        if vowel && !previous_was_vowel {
            groups += 1;
        }
        previous_was_vowel = vowel;
    }

    // A final "e" after a consonant is usually silent ("make"), except in a
    // consonant + "le" ending ("table").
    let n = letters.len();
    if n >= 2 && letters[n - 1] == 'e' && !is_vowel(letters[n - 2]) {
        let consonant_le = n >= 3 && letters[n - 2] == 'l' && !is_vowel(letters[n - 3]);
        if !consonant_le {
            groups -= 1;
        }
    }

    groups.max(1)
}

impl Stats {
    /// Writes the stats as a JSON object.
    ///
    /// Every value is a number or `null`, so no string needs escaping and the
    /// crate needs no JSON library.
    pub fn to_json(&self) -> String {
        fn number(value: Option<f64>) -> String {
            match value {
                Some(v) => format!("{v:.1}"),
                None => "null".to_string(),
            }
        }

        format!(
            concat!(
                "{{",
                "\"characters\":{},",
                "\"words\":{},",
                "\"sentences\":{},",
                "\"paragraphs\":{},",
                "\"syllables\":{},",
                "\"longest_sentence_words\":{},",
                "\"reading_time_seconds\":{},",
                "\"average_words_per_sentence\":{},",
                "\"flesch_reading_ease\":{},",
                "\"flesch_kincaid_grade\":{}",
                "}}"
            ),
            self.characters,
            self.words,
            self.sentences,
            self.paragraphs,
            self.syllables,
            self.longest_sentence_words,
            self.reading_time_seconds,
            number(self.average_words_per_sentence),
            number(self.flesch_reading_ease),
            number(self.flesch_kincaid_grade),
        )
    }
}

/// The boundary between JavaScript and Rust.
///
/// WebAssembly functions take and return only numbers. To pass a string, both
/// sides agree on a pointer and a length into the module's linear memory, which
/// JavaScript sees as one `ArrayBuffer`:
///
/// 1. JavaScript calls `text_stats_alloc(len)` and copies the UTF-8 bytes of
///    the text to the pointer it gets back.
/// 2. JavaScript calls `text_stats_analyze(ptr, len)`. Rust reads the bytes,
///    builds the JSON, and returns where the JSON is.
/// 3. JavaScript copies the JSON out and calls `text_stats_free` on both
///    buffers.
///
/// Tools such as `wasm-bindgen` generate this code. It is written by hand here
/// so that every step is visible.
#[cfg(target_arch = "wasm32")]
mod ffi {
    use std::alloc::{Layout, alloc, dealloc};

    /// Reserves `len` bytes and returns a pointer to them, or null when the
    /// allocation fails.
    #[unsafe(no_mangle)]
    pub extern "C" fn text_stats_alloc(len: usize) -> *mut u8 {
        if len == 0 {
            // A zero-size allocation is not allowed. Any non-null, aligned
            // pointer stands in for an empty buffer.
            return std::ptr::NonNull::dangling().as_ptr();
        }
        match Layout::array::<u8>(len) {
            // SAFETY: the layout has a non-zero size.
            Ok(layout) => unsafe { alloc(layout) },
            Err(_) => std::ptr::null_mut(),
        }
    }

    /// Releases a buffer.
    ///
    /// # Safety
    ///
    /// `ptr` and `len` must come from `text_stats_alloc` or
    /// `text_stats_analyze`, and the buffer must not be freed twice.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn text_stats_free(ptr: *mut u8, len: usize) {
        if len == 0 || ptr.is_null() {
            return;
        }
        if let Ok(layout) = Layout::array::<u8>(len) {
            // SAFETY: the caller promises the buffer was allocated with this
            // same layout.
            unsafe { dealloc(ptr, layout) };
        }
    }

    /// Analyses the UTF-8 text at `ptr` and returns the location of a JSON
    /// string: the pointer in the high 32 bits and the length in the low 32.
    /// JavaScript receives the `u64` as a `BigInt`.
    ///
    /// # Safety
    ///
    /// `ptr` must point to `len` readable bytes.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn text_stats_analyze(ptr: *const u8, len: usize) -> u64 {
        let bytes: &[u8] = if len == 0 {
            &[]
        } else {
            // SAFETY: the caller promises `ptr` points to `len` readable bytes.
            unsafe { std::slice::from_raw_parts(ptr, len) }
        };

        // Invalid UTF-8 becomes replacement characters instead of a panic.
        let text = String::from_utf8_lossy(bytes);
        let json = super::analyze(&text).to_json();

        // A boxed slice has exactly `len` bytes of capacity, which is what
        // `text_stats_free` expects. `leak` hands ownership to the caller.
        let out: &'static mut [u8] = Box::leak(json.into_bytes().into_boxed_slice());
        ((out.as_mut_ptr() as u64) << 32) | (out.len() as u64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_a_short_text() {
        let stats = analyze("The cat sat on the mat. It was happy!");
        assert_eq!(stats.characters, 37);
        assert_eq!(stats.words, 9);
        assert_eq!(stats.sentences, 2);
        assert_eq!(stats.paragraphs, 1);
        assert_eq!(stats.syllables, 10);
        assert_eq!(stats.longest_sentence_words, 6);
        assert_eq!(stats.reading_time_seconds, 3);
        assert_eq!(stats.average_words_per_sentence, Some(4.5));
    }

    #[test]
    fn empty_text_has_no_scores() {
        for text in ["", "   \n\n  ", "— … !"] {
            let stats = analyze(text);
            assert_eq!(stats.words, 0, "{text:?}");
            assert_eq!(stats.sentences, 0, "{text:?}");
            assert_eq!(stats.paragraphs, 0, "{text:?}");
            assert_eq!(stats.flesch_reading_ease, None, "{text:?}");
            assert_eq!(stats.flesch_kincaid_grade, None, "{text:?}");
        }
    }

    #[test]
    fn counts_paragraphs_and_unpunctuated_lines() {
        let stats =
            analyze("A heading\n\nFirst paragraph here.\nStill the first.\r\n\r\nSecond one");
        assert_eq!(stats.paragraphs, 3);
        // The heading, two sentences, and the unfinished last line.
        assert_eq!(stats.sentences, 4);
    }

    #[test]
    fn a_decimal_point_does_not_end_a_sentence() {
        let stats = analyze("Pi is about 3.14 in value. \"Really?\" Yes.");
        assert_eq!(stats.sentences, 3);
        assert_eq!(stats.words, 8);
    }

    #[test]
    fn estimates_syllables() {
        for (word, expected) in [
            ("the", 1),
            ("cat", 1),
            ("make", 1),
            ("whale", 1),
            ("happy", 2),
            ("table", 2),
            ("simple", 2),
            ("sentence", 2),
            ("reading", 2),
            ("banana", 3),
            ("2026", 1),
        ] {
            assert_eq!(count_syllables(word), expected, "{word}");
        }
    }

    #[test]
    fn counts_characters_not_bytes() {
        // "é" is two bytes in UTF-8 and one character.
        assert_eq!(analyze("café").characters, 4);
    }

    #[test]
    fn writes_json() {
        assert_eq!(
            analyze("The cat sat on the mat. It was happy!").to_json(),
            concat!(
                "{\"characters\":37,\"words\":9,\"sentences\":2,\"paragraphs\":1,",
                "\"syllables\":10,\"longest_sentence_words\":6,\"reading_time_seconds\":3,",
                "\"average_words_per_sentence\":4.5,\"flesch_reading_ease\":108.3,",
                "\"flesch_kincaid_grade\":-0.7}"
            )
        );
        assert!(
            analyze("")
                .to_json()
                .contains("\"flesch_reading_ease\":null")
        );
    }
}
