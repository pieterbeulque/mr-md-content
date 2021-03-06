/**
 * @author Titus Wormer
 * @copyright 2015 Titus Wormer
 * @license MIT
 * @module parse-entities
 * @fileoverview Parse HTML character references: fast, spec-compliant,
 *   positional information.
 */

'use strict';

/* eslint-env commonjs */

/*
 * Dependencies.
 */

var characterEntities = require('character-entities');
var legacy = require('character-entities-legacy');
var invalid = require('character-reference-invalid');

/*
 * Methods.
 */

var fromCharCode = String.fromCharCode;
var has = Object.prototype.hasOwnProperty;
var noop = Function.prototype;

/*
 * Reference types.
 */

var NAMED = 'named';
var HEXADECIMAL = 'hexadecimal';
var DECIMAL = 'decimal';

/*
 * Map of bases.
 */

var BASE = {};

BASE[HEXADECIMAL] = 16;
BASE[DECIMAL] = 10;

/*
 * Warning messages.
 */

var NUMERIC_REFERENCE = 'Numeric character references';
var NAMED_REFERENCE = 'Named character references';
var TERMINATED = ' must be terminated by a semicolon';
var VOID = ' cannot be empty';

var NAMED_NOT_TERMINATED = 1;
var NUMERIC_NOT_TERMINATED = 2;
var NAMED_EMPTY = 3;
var NUMERIC_EMPTY = 4;
var NAMED_UNKNOWN = 5;
var NUMERIC_DISALLOWED = 6;
var NUMERIC_PROHIBITED = 7;

var MESSAGES = {};

MESSAGES[NAMED_NOT_TERMINATED] = NAMED_REFERENCE + TERMINATED;
MESSAGES[NUMERIC_NOT_TERMINATED] = NUMERIC_REFERENCE + TERMINATED;
MESSAGES[NAMED_EMPTY] = NAMED_REFERENCE + VOID;
MESSAGES[NUMERIC_EMPTY] = NUMERIC_REFERENCE + VOID;
MESSAGES[NAMED_UNKNOWN] = NAMED_REFERENCE + ' must be known';
MESSAGES[NUMERIC_DISALLOWED] = NUMERIC_REFERENCE + ' cannot be disallowed';
MESSAGES[NUMERIC_PROHIBITED] = NUMERIC_REFERENCE + ' cannot be outside the ' +
    'permissible Unicode range';

/*
 * Characters.
 */

var REPLACEMENT = '\uFFFD';
var FORM_FEED = '\f';
var AMPERSAND = '&';
var OCTOTHORP = '#';
var SEMICOLON = ';';
var NEWLINE = '\n';
var X_LOWER = 'x';
var X_UPPER = 'X';
var SPACE = ' ';
var LESS_THAN = '<';
var EQUAL = '=';
var EMPTY = '';
var TAB = '\t';

/**
 * Get the character-code at the first indice in
 * `character`.
 *
 * @param {string} character - Value.
 * @return {number} - Character-code at the first indice
 *   in `character`.
 */
function charCode(character) {
    return character.charCodeAt(0);
}

/**
 * Check whether `character` is a decimal.
 *
 * @param {string} character - Value.
 * @return {boolean} - Whether `character` is a decimal.
 */
function isDecimal(character) {
    var code = charCode(character);

    return code >= 48 /* 0 */ && code <= 57 /* 9 */;
}

/**
 * Check whether `character` is a hexadecimal.
 *
 * @param {string} character - Value.
 * @return {boolean} - Whether `character` is a
 *   hexadecimal.
 */
function isHexadecimal(character) {
    var code = charCode(character);

    return (code >= 48 /* 0 */ && code <= 57 /* 9 */) ||
        (code >= 65 /* A */ && code <= 70 /* F */) ||
        (code >= 97 /* a */ && code <= 102 /* f */);
}

/**
 * Check whether `character` is an alphanumeric.
 *
 * @param {string} character - Value.
 * @return {boolean} - Whether `character` is an
 *   alphanumeric.
 */
function isAlphanumeric(character) {
    var code = charCode(character);

    return (code >= 48 /* 0 */ && code <= 57 /* 9 */) ||
        (code >= 65 /* A */ && code <= 90 /* Z */) ||
        (code >= 97 /* a */ && code <= 122 /* z */);
}

/**
 * Check whether `character` is outside the permissible
 * unicode range.
 *
 * @param {number} characterCode - Value.
 * @return {boolean} - Whether `character` is an
 *   outside the permissible unicode range.
 */
function isProhibited(characterCode) {
    return (characterCode >= 0xD800 && characterCode <= 0xDFFF) ||
        (characterCode > 0x10FFFF);
}

/**
 * Check whether `character` is disallowed.
 *
 * @param {number} characterCode - Value.
 * @return {boolean} - Whether `character` is disallowed.
 */
function isWarning(characterCode) {
    return (characterCode >= 0x0001 && characterCode <= 0x0008) ||
        (characterCode >= 0x000D && characterCode <= 0x001F) ||
        (characterCode >= 0x007F && characterCode <= 0x009F) ||
        (characterCode >= 0xFDD0 && characterCode <= 0xFDEF) ||
        characterCode === 0x000B ||
        characterCode === 0xFFFE ||
        characterCode === 0xFFFF ||
        characterCode === 0x1FFFE ||
        characterCode === 0x1FFFF ||
        characterCode === 0x2FFFE ||
        characterCode === 0x2FFFF ||
        characterCode === 0x3FFFE ||
        characterCode === 0x3FFFF ||
        characterCode === 0x4FFFE ||
        characterCode === 0x4FFFF ||
        characterCode === 0x5FFFE ||
        characterCode === 0x5FFFF ||
        characterCode === 0x6FFFE ||
        characterCode === 0x6FFFF ||
        characterCode === 0x7FFFE ||
        characterCode === 0x7FFFF ||
        characterCode === 0x8FFFE ||
        characterCode === 0x8FFFF ||
        characterCode === 0x9FFFE ||
        characterCode === 0x9FFFF ||
        characterCode === 0xAFFFE ||
        characterCode === 0xAFFFF ||
        characterCode === 0xBFFFE ||
        characterCode === 0xBFFFF ||
        characterCode === 0xCFFFE ||
        characterCode === 0xCFFFF ||
        characterCode === 0xDFFFE ||
        characterCode === 0xDFFFF ||
        characterCode === 0xEFFFE ||
        characterCode === 0xEFFFF ||
        characterCode === 0xFFFFE ||
        characterCode === 0xFFFFF ||
        characterCode === 0x10FFFE ||
        characterCode === 0x10FFFF;
}

/*
 * Map of types to tests. Each type of character reference
 * accepts different characters. This test is used to
 * detect whether a reference has ended (as the semicolon
 * is not strictly needed).
 */

var TESTS = {};

TESTS[NAMED] = isAlphanumeric;
TESTS[DECIMAL] = isDecimal;
TESTS[HEXADECIMAL] = isHexadecimal;

/**
 * Parse entities.
 *
 * @param {string} value - Value to tokenise.
 * @param {Object?} [settings] - Configuration.
 */
function parse(value, settings) {
    var additional = settings.additional;
    var handleText = settings.text;
    var handleReference = settings.reference;
    var handleWarning = settings.warning;
    var textContext = settings.textContext;
    var referenceContext = settings.referenceContext;
    var warningContext = settings.warningContext;
    var pos = settings.position;
    var indent = settings.indent || [];
    var length = value.length;
    var index = 0;
    var lines = -1;
    var column = pos.column || 1;
    var line = pos.line || 1;
    var queue = EMPTY;
    var result = [];
    var entityCharacters;
    var terminated;
    var characters;
    var character;
    var reference;
    var following;
    var warning;
    var reason;
    var output;
    var entity;
    var begin;
    var start;
    var type;
    var test;
    var prev;
    var next;
    var diff;
    var end;

    /**
     * Get current position.
     *
     * @return {Object} - Positional information of a
     *   single point.
     */
    function now() {
        return {
            'line': line,
            'column': column,
            'offset': index + (pos.offset || 0)
        };
    }

    /**
     * “Throw” a parse-error: a warning.
     *
     * @param {number} code - Identifier of reason for
     *   failing.
     * @param {number} offset - Offset in characters from
     *   the current position point at which the
     *   parse-error ocurred, cannot point past newlines.
     */
    function parseError(code, offset) {
        var position = now();

        position.column += offset;
        position.offset += offset;

        handleWarning.call(warningContext, MESSAGES[code], position, code);
    }

    /**
     * Get character at position.
     *
     * @param {number} position - Indice of character in `value`.
     * @return {string} - Character at `position` in
     *   `value`.
     */
    function at(position) {
        return value.charAt(position);
    }

    /**
     * Flush `queue` (normal text). Macro invoked before
     * each entity and at the end of `value`.
     *
     * Does nothing when `queue` is empty.
     */
    function flush() {
        if (queue) {
            result.push(queue);

            if (handleText) {
                handleText.call(textContext, queue, {
                    'start': prev,
                    'end': now()
                });
            }

            queue = EMPTY;
        }
    }

    /*
     * Cache the current point.
     */

    prev = now();

    /*
     * Wrap `handleWarning`.
     */

    warning = handleWarning ? parseError : noop;

    /*
     * Ensure the algorithm walks over the first character
     * and the end (inclusive).
     */

    index--;
    length++;

    while (++index < length) {
        /*
         * If the previous character was a newline.
         */

        if (character === NEWLINE) {
            column = indent[lines] || 1;
        }

        character = at(index);

        /*
         * Handle anything other than an ampersand,
         * including newlines and EOF.
         */

        if (character !== AMPERSAND) {
            if (character === NEWLINE) {
                line++;
                lines++;
                column = 0;
            }

            if (character) {
                queue += character;
                column++;
            } else {
                flush();
            }
        } else {
            following = at(index + 1);

            /*
             * The behaviour depends on the identity of the next character.
             */

            if (
                following === TAB ||
                following === NEWLINE ||
                following === FORM_FEED ||
                following === SPACE ||
                following === LESS_THAN ||
                following === AMPERSAND ||
                following === EMPTY ||
                (additional && following === additional)
            ) {
                /*
                 * Not a character reference. No characters
                 * are consumed, and nothing is returned.
                 * This is not an error, either.
                 */

                queue += character;
                column++;

                continue;
            }

            start = begin = end = index + 1;

            /*
             * Numerical entity.
             */

            if (following !== OCTOTHORP) {
                type = NAMED;
            } else {
                end = ++begin;

                /*
                 * The behaviour further depends on the
                 * character after the U+0023 NUMBER SIGN.
                 */

                following = at(end);

                if (following === X_LOWER || following === X_UPPER) {
                    /*
                     * ASCII hex digits.
                     */

                    type = HEXADECIMAL;
                    end = ++begin;
                } else {
                    /*
                     * ASCII digits.
                     */

                    type = DECIMAL;
                }
            }

            entityCharacters = entity = characters = EMPTY;
            test = TESTS[type];
            end--;

            while (++end < length) {
                following = at(end);

                if (!test(following)) {
                    break;
                }

                characters += following;

                /*
                 * Check if we can match a legacy named
                 * reference.  If so, we cache that as the
                 * last viable named reference.  This
                 * ensures we do not need to walk backwards
                 * later.
                 */

                if (
                    type === NAMED &&
                    has.call(legacy, characters)
                ) {
                    entityCharacters = characters;
                    entity = legacy[characters];
                }
            }

            terminated = at(end) === SEMICOLON;

            if (terminated) {
                end++;

                if (
                    type === NAMED &&
                    has.call(characterEntities, characters)
                ) {
                    entityCharacters = characters;
                    entity = characterEntities[characters];
                }
            }

            diff = 1 + end - start;

            if (!characters) {
                /*
                 * An empty (possible) entity is valid, unless
                 * its numeric (thus an ampersand followed by
                 * an octothorp).
                 */

                if (type !== NAMED) {
                    warning(NUMERIC_EMPTY, diff);
                }
            } else if (type === NAMED) {
                /*
                 * An ampersand followed by anything
                 * unknown, and not terminated, is invalid.
                 */

                if (terminated && !entity) {
                    warning(NAMED_UNKNOWN, 1);
                } else {
                    /*
                     * If theres something after an entity
                     * name which is not known, cap the
                     * reference.
                     */

                    if (entityCharacters !== characters) {
                        end = begin + entityCharacters.length;
                        diff = 1 + end - begin;
                        terminated = false;
                    }

                    /*
                     * If the reference is not terminated,
                     * warn.
                     */

                    if (!terminated) {
                        reason = entityCharacters ?
                            NAMED_NOT_TERMINATED :
                            NAMED_EMPTY;

                        if (!settings.attribute) {
                            warning(reason, diff);
                        } else {
                            following = at(end);

                            if (following === EQUAL) {
                                warning(reason, diff);
                                entity = null;
                            } else if (isAlphanumeric(following)) {
                                entity = null;
                            } else {
                                warning(reason, diff);
                            }
                        }
                    }
                }

                reference = entity;
            } else {
                if (!terminated) {
                    /*
                     * All non-terminated numeric entities are
                     * not rendered, and trigger a warning.
                     */

                    warning(NUMERIC_NOT_TERMINATED, diff);
                }

                /*
                 * When terminated and number, parse as
                 * either hexadecimal or decimal.
                 */

                reference = parseInt(characters, BASE[type]);

                /*
                 * Trigger a warning when the parsed number
                 * is prohibited, and replace with
                 * replacement character.
                 */

                if (isProhibited(reference)) {
                    warning(NUMERIC_PROHIBITED, diff);

                    reference = REPLACEMENT;
                } else if (reference in invalid) {
                    /*
                     * Trigger a warning when the parsed number
                     * is disallowed, and replace by an
                     * alternative.
                     */

                    warning(NUMERIC_DISALLOWED, diff);

                    reference = invalid[reference];
                } else {
                    /*
                     * Parse the number.
                     */

                    output = EMPTY;

                    /*
                     * Trigger a warning when the parsed
                     * number should not be used.
                     */

                    if (isWarning(reference)) {
                        warning(NUMERIC_DISALLOWED, diff);
                    }

                    /*
                     * Stringify the number.
                     */

                    if (reference > 0xFFFF) {
                        reference -= 0x10000;
                        output += fromCharCode(
                            reference >>> 10 & 0x3FF | 0xD800
                        );

                        reference = 0xDC00 | reference & 0x3FF;
                    }

                    reference = output + fromCharCode(reference);
                }
            }

            /*
             * If we could not find a reference, queue the
             * checked characters (as normal characters),
             * and move the pointer to their end. This is
             * possible because we can be certain neither
             * newlines nor ampersands are included.
             */

            if (!reference) {
                characters = value.slice(start - 1, end);
                queue += characters;
                column += characters.length;
                index = end - 1;
            } else {
                /*
                 * Found it! First eat the queued
                 * characters as normal text, then eat
                 * an entity.
                 */

                flush();

                prev = now();
                index = end - 1;
                column += end - start + 1;
                result.push(reference);
                next = now();
                next.offset++;

                if (handleReference) {
                    handleReference.call(referenceContext, reference, {
                        'start': prev,
                        'end': next
                    }, value.slice(start - 1, end));
                }

                prev = next;
            }
        }
    }

    /*
     * Return the reduced nodes, and any possible warnings.
     */

    return result.join(EMPTY);
}

var defaults = {
    'warning': null,
    'reference': null,
    'text': null,
    'warningContext': null,
    'referenceContext': null,
    'textContext': null,
    'position': {},
    'additional': null,
    'attribute': false
};

/**
 * Wrap to ensure clean parameters are given to `parse`.
 *
 * @param {string} value - Value with entities.
 * @param {Object?} [options] - Configuration.
 */
function wrapper(value, options) {
    var settings = {};
    var key;

    if (!options) {
        options = {};
    }

    for (key in defaults) {
        settings[key] = options[key] || defaults[key];
    }

    if (settings.position.indent || settings.position.start) {
        settings.indent = settings.position.indent || [];
        settings.position = settings.position.start;
    }

    return parse(value, settings);
}

/*
 * Expose.
 */

module.exports = wrapper;
