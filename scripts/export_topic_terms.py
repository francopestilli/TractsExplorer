#!/usr/bin/env python3
"""Export the full term list of every LDA topic for the viewer's topic panel.

Reads the gradec / NeuroQuery LDA files that decode-tracts.ipynb fetches with
_fetch_features / _fetch_frequencies / _fetch_classification, and writes
data/decoding/topic-terms.json:

  {"source": ..., "topics": {"<id>": {"class": <topic class>,
                                      "terms": [[term, weight, class], ...]}}}

<id> is 1-based, matching the matrix.csv column names ("102_novel_..." is
row 102 of the features file). Weights are the LDA term frequencies,
normalised so the top term of each topic is 1.0.

Usage: python3 scripts/export_topic_terms.py [path/to/data/decoding]
"""
import csv
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    HERE, '..', '..', 'Kims-Revisions', 'data', 'decoding')
OUT = os.path.join(HERE, '..', 'data', 'decoding', 'topic-terms.json')
PREFIX = 'source-neuroquery_desc-lda_'


def rows(name):
    with open(os.path.join(SRC, PREFIX + name + '.csv'), newline='') as f:
        return list(csv.reader(f))[1:]


features, freqs, classes = rows('features'), rows('frequencies'), rows('classification')
assert len(features) == len(freqs) == len(classes), 'topic counts differ'

topics = {}
for i, (terms, fr, cl) in enumerate(zip(features, freqs, classes), start=1):
    terms = [t for t in terms if t]
    topic_class, term_classes = cl[0], cl[1:]
    top = float(fr[0]) or 1.0
    topics[str(i)] = {
        'class': topic_class,
        'terms': [[t, round(float(fr[j]) / top, 4), term_classes[j]] for j, t in enumerate(terms)],
    }

with open(OUT, 'w') as f:
    json.dump({'source': 'NeuroQuery LDA (gradec), ' + PREFIX + '{features,frequencies,classification}.csv',
               'topics': topics}, f, separators=(',', ':'))
print(f'Wrote {len(topics)} topics to {os.path.relpath(OUT)}')
