/**
 * Output cleaning and formatting utility for CLI outputs
 * Handles ANSI escape code removal and content filtering
 */
class OutputCleaner {
  /**
   * Remove ANSI escape codes from text
   * @param {string} text - Text containing ANSI codes
   * @returns {string} Cleaned text
   */
  removeAnsiCodes(text) {
    if (!text || typeof text !== 'string') {
      return text;
    }

    return text
      // Remove proper ANSI escape sequences
      .replace(/\x1b\[[0-9;]*[mGKHF]/g, '')     // Most common ANSI sequences
      .replace(/\u001b\[[0-9;]*[mGKHF]/g, '')   // Unicode escape sequences
      .replace(/\x1b\[[0-9;]*[ABCD]/g, '')      // Cursor movement
      .replace(/\x1b\[[0-9;]*[JK]/g, '')        // Clear screen/line
      .replace(/\x1b\[\?[0-9;]*[lh]/g, '')      // Cursor visibility
      .replace(/\x1b\[[0-9]*[A-Za-z]/g, '')     // Any other ANSI sequences
      // Remove malformed ANSI sequences (with � replacement character)
      .replace(/�\[\?[0-9;]*[lh]/g, '')         // Malformed cursor visibility
      .replace(/�\[[?0-9;]*[A-Za-z]/g, '')      // Other malformed sequences
      .replace(/�/g, '')                        // Any remaining replacement characters
      // Remove orphaned ANSI fragments that got partially decoded
      .replace(/\[?\?25[lh]/g, '')              // Leftover cursor control fragments
      .replace(/\[[0-9;]*[mGKHF]/g, '')         // Leftover CSI sequences without ESC
      .trim();
  }

  /**
   * Remove tool execution blocks and UI noise from CLI output
   * Looks for the result marker "🎯 **Application observability for AWS Assistant Result**"
   * and keeps everything from that line onward
   * Falls back to cursor control sequence or "● Completed in" marker if result marker not found
   * @param {string} text - Text containing tool execution blocks and UI elements
   * @returns {string} Cleaned analysis result
   */
  removeToolExecutionBlocks(text) {
    const core = require('@actions/core');
    const lines = text.split('\n');
    let startIndex = 0;
    let filterMethod = 'none';

    // First, try to find the result marker (most reliable)
    const resultMarker = '🎯 **Application observability for AWS Assistant Result**';
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === resultMarker) {
        startIndex = i;
        filterMethod = 'result_marker';
        break;
      }
    }

    // Fallback 1: Look for the last cursor control sequence (marks start of actual output)
    if (startIndex === 0) {
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].includes('�[?25l')) {
          startIndex = i + 1; // Start from line after cursor control
          filterMethod = 'cursor_control';
          break;
        }
      }
    }

    // Fallback 2: Use the last "● Completed in" line
    if (startIndex === 0) {
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].trim().match(/^●\s*Completed in/)) {
          startIndex = i + 1; // Start from line after completion
          filterMethod = 'tool_completion';
          break;
        }
      }
    }

    core.debug(`Output filtering method: ${filterMethod}, starting from line ${startIndex} of ${lines.length}`);

    const filteredLines = lines.slice(startIndex);

    // Amazon Q CLI uses ">" prefix for both thinking statements and final results:
    // - Thinking statements (intermediate): "> Analyzing the code...", "> Checking metrics..."
    // - Final result (last one): "> SLO Status for service:", "> Root Cause Analysis:", etc.
    // We keep only the LAST ">" line as it contains the actual result/summary we want to display

    // Find all lines starting with ">" (thinking statements and results)
    const linesWithArrow = [];
    filteredLines.forEach((line, index) => {
      if (line.trim().startsWith('>')) {
        linesWithArrow.push(index);
      }
    });

    // Remove thinking statements (lines starting with ">") but keep the last one (strip the ">")
    const lastArrowIndex = linesWithArrow.length > 0 ? linesWithArrow[linesWithArrow.length - 1] : -1;

    const finalLines = filteredLines.map((line, index) => {
      const trimmed = line.trim();

      // For the last line starting with ">", remove the ">" symbol
      if (trimmed.startsWith('>') && index === lastArrowIndex) {
        return line.replace(/^\s*>\s*/, '');
      }

      return line;
    }).filter((line, index) => {
      const originalTrimmed = filteredLines[index].trim();

      // Keep lines that don't start with ">"
      if (!originalTrimmed.startsWith('>')) {
        return true;
      }

      // Keep the last line starting with ">" (now with ">" removed)
      if (index === lastArrowIndex) {
        return true;
      }

      // Remove all other thinking statements
      return false;
    });

    return finalLines.join('\n').trim();
  }

  /**
   * Ensure markdown formatting is preserved for GitHub
   * Fixes spacing and formatting issues that can break markdown rendering
   * @param {string} text - Text with markdown
   * @returns {string} Properly formatted markdown
   */
  ensureMarkdownFormatting(text) {
    if (!text || typeof text !== 'string') {
      return text;
    }

    // Remove any trailing whitespace from each line that might break markdown
    const lines = text.split('\n');
    const processedLines = lines.map(line => line.trimEnd());

    // Join lines
    let cleaned = processedLines.join('\n');

    // Ensure proper spacing around headers (GitHub requires blank line before headers)
    cleaned = cleaned.replace(/([^\n])\n(#{1,6}\s+)/g, '$1\n\n$2');

    // Ensure proper spacing after headers
    cleaned = cleaned.replace(/(#{1,6}\s+[^\n]+)\n([^\n#])/g, '$1\n\n$2');

    // Ensure proper spacing around horizontal rules
    cleaned = cleaned.replace(/([^\n])\n(---+)\n/g, '$1\n\n$2\n\n');

    // Remove excessive blank lines (more than 2 consecutive)
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    // Ensure content starts and ends cleanly
    return cleaned.trim();
  }

  /**
   * Clean Amazon Q CLI output (removes ANSI codes and tool execution blocks)
   * @param {string} text - Raw Amazon Q CLI output
   * @returns {string} Cleaned output
   */
  cleanAmazonQOutput(text) {
    let cleaned = this.removeAnsiCodes(text);
    cleaned = this.removeToolExecutionBlocks(cleaned);
    cleaned = this.ensureMarkdownFormatting(cleaned);
    return cleaned;
  }

  /**
   * Generic clean method - uses Amazon Q output cleaning
   * @param {string} text - Raw CLI output
   * @returns {string} Cleaned output
   */
  clean(text) {
    return this.cleanAmazonQOutput(text);
  }
}

module.exports = { OutputCleaner };
