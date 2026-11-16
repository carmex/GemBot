/*
 * GemBot: An intelligent Slack assistant with AI capabilities.
 * Copyright (C) 2025 David Lott
 */

import { markdownToSlack, formatMarkdownTables } from '../src/features/utils';

function assert(actual: string, expected: string, message: string) {
    if (actual !== expected) {
        console.error(`FAILED: ${message}`);
        console.error(`  Expected: ${JSON.stringify(expected)}`);
        console.error(`  Actual:   ${JSON.stringify(actual)}`);
        process.exit(1);
    }
    console.log(`PASSED: ${message}`);
}

function assertTableAligned(output: string, message: string) {
    const match = output.match(/```\n([\s\S]*?)\n```/);
    if (!match) {
        console.error(`FAILED: ${message} - No code block found`);
        process.exit(1);
    }
    const tableLines = match[1].split('\n');
    if (tableLines.length < 2) {
        console.error(`FAILED: ${message} - Table must have at least 2 lines (header + delimiter)`);
        process.exit(1);
    }
    const pipeIndicesPerRow = tableLines.map(line => {
        const indices: number[] = [];
        for (let idx = 0; idx < line.length; idx++) {
            if (line[idx] === '|') indices.push(idx);
        }
        return indices;
    });

    const expectedIndices = pipeIndicesPerRow[0];
    if (expectedIndices.length < 2) {
        console.error(`FAILED: ${message} - Header row does not contain valid pipes: ${JSON.stringify(tableLines[0])}`);
        process.exit(1);
    }

    for (let r = 1; r < pipeIndicesPerRow.length; r++) {
        const rowIndices = pipeIndicesPerRow[r];
        if (JSON.stringify(rowIndices) !== JSON.stringify(expectedIndices)) {
            console.error(`FAILED: ${message} - Pipe alignment mismatch on row ${r}`);
            console.error(`  Expected: ${JSON.stringify(expectedIndices)} for line: "${tableLines[0]}"`);
            console.error(`  Actual:   ${JSON.stringify(rowIndices)} for line: "${tableLines[r]}"`);
            process.exit(1);
        }
    }
    console.log(`PASSED: ${message} (all ${tableLines.length} rows aligned at pipes ${JSON.stringify(expectedIndices)})`);
}

function runTests() {
    console.log("Running Markdown to Slack Formatting Tests...");

    // 1. Basic link test
    assert(
        markdownToSlack("Check out [Google](https://google.com)"),
        "Check out <https://google.com|Google>",
        "Basic link conversion"
    );

    // 2. Links at the beginning of a line
    assert(
        markdownToSlack("[Google](https://google.com) is a search engine"),
        "<https://google.com|Google> is a search engine",
        "Link at the beginning of a line"
    );

    // 3. Multiple links with varied spacing
    assert(
        markdownToSlack("[One](https://one.com) and [Two](https://two.com)"),
        "<https://one.com|One> and <https://two.com|Two>",
        "Multiple links conversion"
    );

    // 4. Bullet conversion (*, -, + to •)
    assert(
        markdownToSlack("* Item 1\n- Item 2\n+ Item 3"),
        "• Item 1\n• Item 2\n• Item 3",
        "Basic bullet conversion"
    );

    // 5. Indented bullets
    assert(
        markdownToSlack("  * Indented Item"),
        "  • Indented Item",
        "Indented bullet conversion"
    );

    // 6. Headers to bold
    assert(
        markdownToSlack("### My Header"),
        "*My Header*",
        "Header conversion"
    );

    // 7. Bold and Italic
    assert(
        markdownToSlack("**bold** and __italic__"),
        "*bold* and _italic_",
        "Bold and Italic conversion"
    );

    // 8. Link with <> around URL
    assert(
        markdownToSlack("[Link](<https://example.com>)"),
        "<https://example.com|Link>",
        "Link with angle brackets around URL"
    );

    // 9. Table formatting: user's exact example
    const userTableInput = [
        "| Feature | Underbaked Method | Ganache-Core Method |",
        "| :--- | :--- | :--- |",
        "| *Complexity* | Low (one batter) | High (batter + ganache) |",
        "| *Reliability* | Low (requires perfect timing) | High (core stays liquid) |",
        "| *Center Texture* | Thick, slightly grainy batter | Silky, smooth cream/sauce |",
        "| *Origin* | Jean-Georges Vongerichten (1987) | Michel Bras (1981) |"
    ].join("\n");

    const expectedUserTable = [
        "```",
        "| Feature          | Underbaked Method                | Ganache-Core Method       |",
        "| :--------------- | :------------------------------- | :------------------------ |",
        "| *Complexity*     | Low (one batter)                 | High (batter + ganache)   |",
        "| *Reliability*    | Low (requires perfect timing)    | High (core stays liquid)  |",
        "| *Center Texture* | Thick, slightly grainy batter    | Silky, smooth cream/sauce |",
        "| *Origin*         | Jean-Georges Vongerichten (1987) | Michel Bras (1981)        |",
        "```"
    ].join("\n");

    const userTableOutput = markdownToSlack(userTableInput);
    assert(
        userTableOutput,
        expectedUserTable,
        "User table example exact match"
    );
    assertTableAligned(userTableOutput, "User table vertical delimiter alignment");

    // 10. Table surrounded by regular text and bullets
    const mixedInput = [
        "# Comparison Summary",
        "Here are key differences:",
        "* First point",
        "* Second point",
        "",
        "| Item | Cost | Rating |",
        "| :--- | :--- | :--- |",
        "| Apple | $1 | 4.5 |",
        "| Banana | $0.5 | 4.8 |",
        "",
        "Check [Store](https://example.com) for details."
    ].join("\n");

    const expectedMixedOutput = [
        "*Comparison Summary*",
        "Here are key differences:",
        "• First point",
        "• Second point",
        "",
        "```",
        "| Item   | Cost | Rating |",
        "| :----- | :--- | :----- |",
        "| Apple  | $1   | 4.5    |",
        "| Banana | $0.5 | 4.8    |",
        "```",
        "",
        "Check <https://example.com|Store> for details."
    ].join("\n");

    const mixedOutput = markdownToSlack(mixedInput);
    assert(
        mixedOutput,
        expectedMixedOutput,
        "Table surrounded by text, bullets, headers, and links"
    );
    assertTableAligned(mixedOutput, "Mixed message table vertical delimiter alignment");

    // 11. Tables with varying alignments (left, right, center)
    const alignmentsInput = [
        "| Left | Center | Right |",
        "| :--- | :---: | ---: |",
        "| L | C | R |",
        "| LongerLeft | LongCenter | LongRight |"
    ].join("\n");

    const expectedAlignmentsOutput = [
        "```",
        "| Left       |   Center   |     Right |",
        "| :--------- | :--------: | --------: |",
        "| L          |     C      |         R |",
        "| LongerLeft | LongCenter | LongRight |",
        "```"
    ].join("\n");

    const alignmentsOutput = markdownToSlack(alignmentsInput);
    assert(
        alignmentsOutput,
        expectedAlignmentsOutput,
        "Table with varying column alignments (left, center, right)"
    );
    assertTableAligned(alignmentsOutput, "Varying alignments vertical delimiter alignment");

    // 12. Messages with pre-existing code blocks (prevent double-wrapping and regex conflicts)
    const codeBlockInput = [
        "Here is pre-existing code block:",
        "```ts",
        "function sample() {",
        "  | This | Is | Not | A | Real | Table |",
        "  | --- | --- | --- | --- | --- | --- |",
        "}",
        "```",
        "And inline code `| inline | pipe | table |` should not format."
    ].join("\n");

    const codeBlockOutput = markdownToSlack(codeBlockInput);
    assert(
        codeBlockOutput,
        codeBlockInput,
        "Pre-existing code blocks and inline code are protected without double-wrapping"
    );

    // 13. Standalone formatMarkdownTables verification
    const standaloneTable = formatMarkdownTables(userTableInput);
    assert(
        standaloneTable,
        expectedUserTable,
        "formatMarkdownTables standalone produces properly aligned code block"
    );

    console.log("\nAll formatting tests passed!");
}

runTests();
