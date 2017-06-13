import * as ts from 'typescript';
import {RuleWalker, RuleFailure, IOptions, Fix, Replacement} from 'tslint';
import {CodeWithSourceMap} from './metadata';
import {SourceMapConsumer} from 'source-map';

const LineFeed = 0x0A;
const CarriageReturn = 0x0D;
const MaxAsciiCharacter = 0x7F;
const LineSeparator = 0x2028;
const ParagraphSeparator = 0x2029;

export function isLineBreak(ch: number): boolean {
  return ch === LineFeed ||
      ch === CarriageReturn ||
      ch === LineSeparator ||
      ch === ParagraphSeparator;
}

function binarySearch<T>(array: T[], value: T, comparer?: (v1: T, v2: T) => number, offset?: number): number {
  if (!array || array.length === 0) {
      return -1;
  }

  let low = offset || 0;
  let high = array.length - 1;
  comparer = comparer !== undefined
      ? comparer
      : (v1, v2) => (v1 < v2 ? -1 : (v1 > v2 ? 1 : 0));

  while (low <= high) {
    const middle = low + ((high - low) >> 1);
    const midValue = array[middle];

    if (comparer(midValue, value) === 0) {
      return middle;
    } else if (comparer(midValue, value) > 0) {
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }

  return ~low;
}

// Apply caching and do not recompute every time
function getLineAndCharacterOfPosition(sourceFile: string, position: number) {
  return computeLineAndCharacterOfPosition(computeLineStarts(sourceFile), position);
}

// Apply caching and do not recompute every time
function getPositionOfLineAndCharacter(sourceFile: string, line: number, character: number): number {
  return computePositionOfLineAndCharacter(computeLineStarts(sourceFile), line, character);
}

function computePositionOfLineAndCharacter(lineStarts: number[], line: number, character: number): number {
  return lineStarts[line] + character;
}

function computeLineAndCharacterOfPosition(lineStarts: number[], position: number) {
  let lineNumber = binarySearch(lineStarts, position);
  if (lineNumber < 0) {
    lineNumber = ~lineNumber - 1;
  }
  return {
    line: lineNumber,
    character: position - lineStarts[lineNumber]
  };
}

function computeLineStarts(text: string): number[] {
  const result: number[] = new Array();
  let pos = 0;
  let lineStart = 0;
  while (pos < text.length) {
    const ch = text.charCodeAt(pos);
    pos++;
    switch (ch) {
      case CarriageReturn:
        if (text.charCodeAt(pos) === LineFeed) {
          pos++;
        }
      case LineFeed:
        result.push(lineStart);
        lineStart = pos;
        break;
      default:
        if (ch > MaxAsciiCharacter && isLineBreak(ch)) {
          result.push(lineStart);
          lineStart = pos;
        }
        break;
    }
  }
  result.push(lineStart);
  return result;
}

export class SourceMappingVisitor extends RuleWalker {
  private consumer: SourceMapConsumer;

  constructor(sourceFile: ts.SourceFile, options: IOptions, protected codeWithMap: CodeWithSourceMap, protected basePosition: number) {
    super(sourceFile, options);
    if (this.codeWithMap.map) {
      this.consumer = new SourceMapConsumer(this.codeWithMap.map);
    }
  }

  createFailure(s: number, l: number, message: string, fix?: Fix): RuleFailure {
    const { start, length } = this.getMappedInterval(s, l);
    return super.createFailure(start, length, message, fix);
  }

  createReplacement(s: number, l: number, replacement: string): Replacement {
    const { start, length } = this.getMappedInterval(s, l);
    return super.createReplacement(start, length, replacement);
  }

  getSourcePosition(pos: number) {
    if (this.consumer) {
      try {
        let absPos = getLineAndCharacterOfPosition(this.codeWithMap.code, pos);
        const result = this.consumer.originalPositionFor({ line: absPos.line + 1, column: absPos.character + 1 });
        absPos = { line: result.line - 1, character: result.column - 1 };
        pos = getPositionOfLineAndCharacter(this.codeWithMap.source, absPos.line, absPos.character);
      } catch (e) {
        console.log(e);
      }
    }
    return pos + this.basePosition;
  }

  private getMappedInterval(start: number, length: number) {
    let end = start + length;
    start = this.getSourcePosition(start);
    end = this.getSourcePosition(end);
    return { start, length: end - start };
  }
}
