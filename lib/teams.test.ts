import assert from 'node:assert/strict'
import { test } from 'node:test'

import { teamsVisibleTo, departmentLabel } from './types.ts'

/**
 * The one rule in the product that decides whether one department account can
 * read another team's guests. Run with `npm test`.
 */
test('a manager, an admin and HConcierge see every team', () => {
  for (const role of ['manager', 'admin', 'platform']) {
    assert.deepEqual(teamsVisibleTo(role, 'all'), [], `${role} is unscoped`)
    // Even if a stale extra_teams list is sitting on the row.
    assert.deepEqual(teamsVisibleTo(role, 'housekeeping', ['fnb']), [], `${role} ignores extras`)
  }
})

test('a department account sees its own team', () => {
  assert.deepEqual(teamsVisibleTo('staff', 'housekeeping'), ['housekeeping'])
  assert.deepEqual(teamsVisibleTo('staff', 'housekeeping', []), ['housekeeping'])
  assert.deepEqual(teamsVisibleTo('staff', 'housekeeping', null), ['housekeeping'])
})

test('a department account also sees the teams it covers', () => {
  assert.deepEqual(teamsVisibleTo('staff', 'housekeeping', ['spa_wellness']), ['housekeeping', 'spa_wellness'])
  assert.deepEqual(teamsVisibleTo('staff', 'housekeeping', ['laundry', 'spa_wellness']), [
    'housekeeping',
    'laundry',
    'spa_wellness',
  ])
})

test('the list never repeats a team or carries an empty one', () => {
  assert.deepEqual(teamsVisibleTo('staff', 'housekeeping', ['housekeeping']), ['housekeeping'])
  assert.deepEqual(teamsVisibleTo('staff', 'fnb', ['fnb', 'fnb']), ['fnb'])
  assert.deepEqual(teamsVisibleTo('staff', 'fnb', ['', 'bar']), ['fnb', 'bar'])
})

test('a staff account on "all" is unscoped, which is how the seed ships it', () => {
  assert.deepEqual(teamsVisibleTo('staff', 'all'), [])
  assert.deepEqual(teamsVisibleTo('staff', 'all', ['fnb']), [])
})

test('a custom team reads as words when there is no list to look it up in', () => {
  assert.equal(departmentLabel('spa_wellness'), 'Spa wellness')
  assert.equal(departmentLabel('housekeeping'), 'Housekeeping')
  assert.equal(departmentLabel('all'), 'All teams')
  assert.equal(departmentLabel(''), 'Unassigned')
})
