"""Run from the repository root: python -m unittest discover -s eval -v."""
import collections
import csv
import json
import os
from pathlib import Path
import subprocess
import unittest

import duckdb
from export_parquet import SELECT_SQL, validate_crashes

ROOT = Path(__file__).resolve().parents[1]
DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']


class CrashDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.con = duckdb.connect()
        cls.con.execute(f"CREATE TABLE crashes AS SELECT * FROM read_parquet('{ROOT / 'data/crashes.parquet'}')")
        # Build an independent reference from the raw CSV at crash grain.
        with (ROOT / 'data/melbourne_cyclist_crashes.csv').open() as handle:
            by_id = {r['accident_no']: r for r in csv.DictReader(handle)}
        cls.records = list(by_id.values())
        for r in cls.records:
            r['council'] = r['lga_name'].replace('MORELAND', 'MERRI-BEK')
            r['hour'] = int(r['accident_time'].split(':')[0])
            r['year'] = int(r['year'])
        cls.councils = sorted({r['council'] for r in cls.records})
        output = subprocess.check_output([os.environ.get('NODE', 'node'), 'eval/query-fixtures.mjs'], cwd=ROOT, text=True)
        cls.fixtures = json.loads(output)

    @classmethod
    def tearDownClass(cls):
        cls.con.close()

    def test_unique_crashes_and_expected_counts(self):
        self.assertEqual(self.con.execute('SELECT COUNT(*), COUNT(DISTINCT crash_id) FROM crashes').fetchone(), (15485, 15485))
        self.assertEqual(dict(self.con.execute('SELECT severity, COUNT(*) FROM crashes GROUP BY 1').fetchall()),
                         {'Fatal': 76, 'Serious Injury': 4871, 'Other Injury': 10538})
        validate_crashes(self.con)

    def test_export_matches_shipped_data(self):
        for sql in [f'({SELECT_SQL}) EXCEPT ALL SELECT * FROM crashes', f'SELECT * FROM crashes EXCEPT ALL ({SELECT_SQL})']:
            self.assertEqual(self.con.execute(f'SELECT COUNT(*) FROM ({sql})').fetchone()[0], 0)

    def test_conflicting_crash_details_fail_validation(self):
        self.con.execute('BEGIN TRANSACTION')
        try:
            self.con.execute("INSERT INTO crashes SELECT * REPLACE (99 AS speed_zone) FROM crashes LIMIT 1")
            with self.assertRaisesRegex(ValueError, 'conflicting'):
                validate_crashes(self.con)
        finally:
            self.con.execute('ROLLBACK')

    def test_invalid_hour_fails_validation(self):
        self.con.execute('BEGIN TRANSACTION')
        try:
            self.con.execute('UPDATE crashes SET crash_hour = 24 WHERE crash_id = (SELECT crash_id FROM crashes LIMIT 1)')
            with self.assertRaisesRegex(ValueError, 'invalid'):
                validate_crashes(self.con)
        finally:
            self.con.execute('ROLLBACK')

    def reference(self, f, name):
        def accepts(r):
            if not f.get('yearMin', 2012) <= r['year'] <= f.get('yearMax', 2025): return False
            if name != 'council' and f.get('council') and r['council'] != f['council']: return False
            severity = 'Fatal' if name == 'fatalCount' else f.get('severity')
            if severity and r['severity_desc'] != severity: return False
            if f.get('notSeverity') and r['severity_desc'] == f['notSeverity']: return False
            if f.get('day') and r['day_week_desc'] != f['day']: return False
            weekend = r['day_week_desc'] in ['Saturday', 'Sunday']
            if f.get('dayPeriod') == 'weekend' and not weekend: return False
            if f.get('dayPeriod') == 'weekday' and weekend: return False
            if 'hour' in f and r['hour'] != f['hour']: return False
            if 'hourMin' in f and not f['hourMin'] <= r['hour'] <= f['hourMax']: return False
            period = f.get('period', 'commute' if name == 'rushHour' else None)
            allowed = {'morning': [7,8,9], 'evening': [16,17,18], 'commute': [7,8,9,16,17,18]}
            if period and r['hour'] not in allowed[period]: return False
            if name == 'byRoadGeometry' and ('intersection' not in r['road_geometry_desc'] or r['road_geometry_desc'] == 'Not at intersection'): return False
            return True
        return [r for r in self.records if accepts(r)]

    def test_query_results_against_raw_csv_reference(self):
        for case in self.fixtures:
            name, f = case['name'], case['f']
            with self.subTest(name=name, filters=f):
                result = self.con.execute(case['sql'])
                rows = [dict(zip([c[0] for c in result.description], row)) for row in result.fetchall()]
                expected = self.reference(f, name)
                if name in ['filteredCount', 'fatalCount']:
                    self.assertEqual(rows[0]['value'], len(expected))
                elif name in ['worstCouncils', 'safestCouncils']:
                    counts = collections.Counter(r['council'] for r in expected)
                    order = sorted(self.councils, key=lambda c: ((-1 if name == 'worstCouncils' else 1) * counts[c], c))[:10]
                    self.assertEqual([(r['label'], r['value']) for r in rows], [(c, counts[c]) for c in order])
                elif name in ['yearlyTrend', 'dangerousYears']:
                    counts = collections.Counter(r['year'] for r in expected)
                    years = list(range(f.get('yearMin', 2012), f.get('yearMax', 2025) + 1))
                    if name == 'dangerousYears': years = sorted(years, key=lambda y: (-counts[y], -y))[:1]
                    self.assertEqual([(int(r['label']), r['value']) for r in rows], [(y, counts[y]) for y in years])
                elif name == 'council':
                    counts = collections.Counter(r['council'] for r in expected)
                    selected = counts[f['council']]
                    rank = 1 + sum(counts[c] > selected for c in self.councils)
                    self.assertEqual(len(rows), f['yearMax'] - f['yearMin'] + 1)
                    self.assertEqual(sum(r['value'] for r in rows), selected)
                    for row in rows:
                        self.assertEqual((row['total'], row['rank'], row['councils']), (selected, rank, 31))
                        self.assertAlmostEqual(row['melbourne_avg_total'], len(expected) / 31)
                        yearly = [r for r in expected if r['year'] == int(row['label'])]
                        self.assertEqual(row['value'], sum(r['council'] == f['council'] for r in yearly))
                        self.assertAlmostEqual(row['melbourne_avg'], round(len(yearly) / 31, 1))
                elif name == 'byHour':
                    self.assertEqual(sum(r['weekday'] + r['weekend'] for r in rows), len(expected))
                    for row in rows:
                        at_hour = [r for r in expected if r['hour'] == row['label']]
                        self.assertEqual(row['weekend'], sum(r['day_week_desc'] in ['Saturday', 'Sunday'] for r in at_hour))
                elif name in ['safestTime', 'rushHour']:
                    counts = collections.Counter(r['hour'] for r in expected)
                    for row in rows: self.assertEqual(row['value'], counts[row['label']])
                    if name == 'rushHour': self.assertEqual(sum(r['value'] for r in rows), len(expected))
                    else:
                        allowed = [h for h in range(24) if ('hour' not in f or h == f['hour']) and ('hourMin' not in f or f['hourMin'] <= h <= f['hourMax'])]
                        self.assertEqual([r['label'] for r in rows], sorted(allowed, key=lambda h: (counts[h], h))[:10])
                else:
                    col = {'bySeverity': 'severity_desc', 'byDayOfWeek': 'day_week_desc', 'byRoadGeometry': 'road_geometry_desc'}[name]
                    counts = collections.Counter(r[col] for r in expected)
                    self.assertEqual({r['label']: r['value'] for r in rows}, dict(counts))
                    if name == 'bySeverity' and rows: self.assertAlmostEqual(sum(r['pct'] for r in rows), 100)


if __name__ == '__main__':
    unittest.main()
