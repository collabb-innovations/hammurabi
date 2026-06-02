---
name: uppercase
version: 0.0.1
description: Converts strings to uppercase
target:
  kind: function
  module: ../impl.ts
  export: upper
---

# Uppercase

Returns the input string with all alphabetic characters in uppercase. Non-alphabetic characters (digits, spaces, punctuation) pass through unchanged. Empty input returns empty string.

## Anti-patterns

- Returning anything other than a string
- Leaving any alphabetic character in lowercase
- Throwing on empty input
