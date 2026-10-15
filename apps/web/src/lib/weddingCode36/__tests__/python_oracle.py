"""Tests only: compare the app engine with the existing, reviewed reference output."""
from pathlib import Path
import hashlib
import json
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[6] / 'docs/wedding-code/results36-2026-10-15/_tools'))
from presentation import present, present_comparison


def canonical(value):
    if isinstance(value, dict):
        return {key: canonical(item) for key, item in value.items()}
    if isinstance(value, list):
        return [canonical(item) for item in value]
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def digest(value):
    text = json.dumps(canonical(value), ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


payload = json.load(sys.stdin)
json.dump({
    'individual': [digest(present(submission)) for submission in payload['individual']],
    'couples': [digest(present_comparison(pair['a'], pair['b'])) for pair in payload['couples']],
}, sys.stdout)
