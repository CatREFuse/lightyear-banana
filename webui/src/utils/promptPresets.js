"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROMPT_PRESET_NAME_MAX_CODE_POINTS = exports.PROMPT_PRESET_LIMIT = void 0;
exports.canonicalizePromptPresetName = canonicalizePromptPresetName;
exports.canonicalize = canonicalizePromptPresetName;
exports.validatePromptPreset = validatePromptPreset;
exports.validate = validatePromptPreset;
exports.normalizePromptPresets = normalizePromptPresets;
exports.normalize = normalizePromptPresets;
exports.filterPromptPresets = filterPromptPresets;
exports.filter = filterPromptPresets;
exports.resolvePromptPresetInput = resolvePromptPresetInput;
exports.resolve = resolvePromptPresetInput;
exports.PROMPT_PRESET_LIMIT = 100;
exports.PROMPT_PRESET_NAME_MAX_CODE_POINTS = 24;
const promptPresetNamePattern = /^[A-Za-z0-9_\-\p{Script=Han}]+$/u;
function normalizePromptPresetName(value) {
    return value.trim().normalize('NFKC');
}
function normalizePromptPresetContent(value) {
    return value.replace(/\r\n?/g, '\n').trim();
}
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function readSingleSlashQuery(input) {
    if (!/^\/[^\s/]*$/u.test(input)) {
        return null;
    }
    return input.slice(1);
}
function canonicalizePromptPresetName(value) {
    return normalizePromptPresetName(value).replace(/[A-Z]/g, (character) => character.toLowerCase());
}
function validatePromptPreset(preset, existingPresets = []) {
    const errors = {};
    const normalizedId = preset.id.trim();
    const normalizedName = normalizePromptPresetName(preset.name);
    const canonicalName = canonicalizePromptPresetName(normalizedName);
    const editingExistingPreset = existingPresets.some((existingPreset) => existingPreset.id === normalizedId);
    if (!normalizedId) {
        errors.id = '预设 ID 不能为空';
    }
    if (!normalizedName) {
        errors.name = '请输入名称';
    }
    else if (Array.from(normalizedName).length > exports.PROMPT_PRESET_NAME_MAX_CODE_POINTS) {
        errors.name = `名称最多 ${exports.PROMPT_PRESET_NAME_MAX_CODE_POINTS} 个字符`;
    }
    else if (!promptPresetNamePattern.test(normalizedName)) {
        errors.name = '仅支持中文、英文字母、数字、_ 和 -';
    }
    else if (existingPresets.some((existingPreset) => existingPreset.id !== normalizedId && canonicalizePromptPresetName(existingPreset.name) === canonicalName)) {
        errors.name = '名称已存在';
    }
    if (!normalizePromptPresetContent(preset.content)) {
        errors.content = '请输入提示词';
    }
    if (!editingExistingPreset && existingPresets.length >= exports.PROMPT_PRESET_LIMIT) {
        errors.limit = `最多保存 ${exports.PROMPT_PRESET_LIMIT} 条预设`;
    }
    return {
        errors,
        valid: Object.keys(errors).length === 0
    };
}
function normalizePromptPresets(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const normalized = [];
    for (const entry of value) {
        if (normalized.length >= exports.PROMPT_PRESET_LIMIT || !isRecord(entry)) {
            continue;
        }
        if (typeof entry.id !== 'string' || typeof entry.name !== 'string' || typeof entry.content !== 'string') {
            continue;
        }
        const preset = {
            id: entry.id.trim(),
            name: normalizePromptPresetName(entry.name),
            content: normalizePromptPresetContent(entry.content)
        };
        if (!normalized.some((existingPreset) => existingPreset.id === preset.id) && validatePromptPreset(preset, normalized).valid) {
            normalized.push(preset);
        }
    }
    return normalized;
}
function filterPromptPresets(presets, input) {
    const rawQuery = readSingleSlashQuery(input);
    if (rawQuery === null) {
        return [];
    }
    const query = canonicalizePromptPresetName(rawQuery);
    return presets
        .map((preset, index) => {
        const name = canonicalizePromptPresetName(preset.name);
        const rank = name === query ? 0 : name.startsWith(query) ? 1 : name.includes(query) ? 2 : 3;
        return { index, preset, rank };
    })
        .filter((entry) => entry.rank < 3)
        .sort((left, right) => left.rank - right.rank || left.index - right.index)
        .map((entry) => entry.preset)
        .slice(0, 6);
}
function resolvePromptPresetInput(input, presets, options = {}) {
    if (options.alreadyExpanded) {
        return {
            kind: 'plain',
            prompt: input
        };
    }
    if (input.startsWith('//')) {
        return {
            kind: 'escaped',
            prompt: input.slice(1)
        };
    }
    const rawName = readSingleSlashQuery(input);
    if (rawName === null) {
        return {
            kind: 'plain',
            prompt: input
        };
    }
    const canonicalName = canonicalizePromptPresetName(rawName);
    const preset = presets.find((candidate) => canonicalizePromptPresetName(candidate.name) === canonicalName);
    if (preset) {
        return {
            kind: 'resolved',
            preset,
            prompt: preset.content
        };
    }
    return {
        kind: 'error',
        message: rawName ? `未找到预设“${rawName}”` : '请选择一个预设提示词',
        prompt: input
    };
}
