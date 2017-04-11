import {mockDOMSource, div, input} from '@cycle/dom';
import {mockTimeSource} from '@cycle/time';
import xs, {Stream} from 'xstream';
import {select} from 'snabbdom-selector';

import {RestCollection} from '../src/rest';

function t (f) {
  return function runTimeTest (done) {
    const Time = mockTimeSource({interval: 100});

    f(Time);

    Time.run(done);
  }
}

function noteView ({text}) {
  return (
    div('.note', [
      div('.text', text),
      input('.foo', {attrs: {value: text}})
    ])
  );
}

function replace (newState) {
  return function reduce (state) {
    return newState;
  }
}

function merge (newState) {
  return function reduce (state) {
    return {
      ...state,
      ...newState
    }
  }
}

function applyReducer (state, reducer) {
  return reducer(state);
}

function Note (sources) {
  const inputChange$ = sources.DOM
    .select('.foo')
    .events('change')
    .map(ev => ev.target.value);

  const reducer$ = xs.merge(
    sources.state$.map(replace),

    inputChange$.map(text => ({text})).map(merge)
  )

  const state$ = reducer$.fold(applyReducer, {}).drop(1);

  return {
    DOM: sources.state$.map(noteView),
    state$
  }
}

function mockHTTPSource (config = {}) {
  return {
    select (category = ':root') {
      return config[category] || xs.empty();
    }
  }
}

function textFromVtree (vtree) {
  if (vtree.children) {
    return vtree.children.map(textFromVtree)
  }

  if (vtree.text) {
    return vtree.text;
  }

  return '';
}

function textFromVtrees (vtrees) {
  return vtrees.map(textFromVtree);
}

describe('rest collection', () => {
  it('makes a request when it starts up', t((Time) => {
    const expectedRequest = {url: '/notes', category: 'index', type: 'application/json'};
    const expectedRequest$ = Time.diagram('a---', {a: expectedRequest});

    const HTTP = mockHTTPSource();
    const collection = RestCollection(Note, {HTTP}, '/notes');

    Time.assertEqual(
      collection.HTTP,
      expectedRequest$
    );
  }));

  it('makes available the results', t((Time) => {
    const response = {
      body: [
        {id: 0, text: 'Hello world'},
        {id: 1, text: 'What a test'}
      ]
    };

    const response$      = Time.diagram('---r|', {r: xs.of(response)})
    const expectedState$ = Time.diagram('i--s|', {i: [], s: response.body});

    const DOM = mockDOMSource({});
    const HTTP = mockHTTPSource({
      'index': response$
    });

    const collection = RestCollection(Note, {Time, DOM, HTTP}, '/notes');

    Time.assertEqual(
      collection.pluck(note => note.state$),
      expectedState$
    );
  }));

  it('makes available the results dom', t((Time) => {
    const response = {
      body: [
        {id: 0, text: 'Hello world'},
        {id: 1, text: 'What a test'}
      ]
    };

    const response$      = Time.diagram('---r|', {r: xs.of(response)})
    const expectedVtree$ = Time.diagram('i--s|', {i: [], s: response.body.map(noteView)});

    const DOM = mockDOMSource({});
    const HTTP = mockHTTPSource({
      'index': response$
    });

    const collection = RestCollection(Note, {Time, DOM, HTTP}, '/notes');

    Time.assertEqual(
      collection.pluck(note => note.DOM).map(textFromVtrees),
      expectedVtree$.map(textFromVtrees)
    );
  }));

  it('allows adding components with optimistic updates', t((Time) => {
    const index = {url: '/notes', category: 'index', type: 'application/json'};
    const create = {url: '/notes', method: 'POST', send: JSON.stringify({note: {text: 'A new one'}}), tempId: `temp-0`, category: 'create', type: 'application/json'};
    const response = {
      body: {id: 0, text: 'A new one'},
    };

    const localState = [
      {tempId: `temp-0`, text: 'A new one'}
    ]

    const savedState = [
      {id: 0, text: 'A new one'}
    ]

    const createResponse$  = xs.of(response);
    createResponse$['request'] = create;

    const add$             = Time.diagram('--a-----', {a: {state$: xs.of({text: 'A new one'})}});
    const response$        = Time.diagram('------r|', {r: createResponse$})
    const expectedState$   = Time.diagram('a-b---c-', {a: [], b: localState, c: savedState});
    const expectedRequest$ = Time.diagram('i-c-----', {i: index, c: create});

    const DOM = mockDOMSource({});
    const HTTP = mockHTTPSource({
      'create': response$
    });

    const collection = RestCollection(Note, {Time, DOM, HTTP, add$}, '/notes');

    Time.assertEqual(
      collection.pluck(note => note.state$),
      expectedState$
    );

    Time.assertEqual(
      collection.HTTP,
      expectedRequest$
    );
  }));

  it('sends updates to the server', t((Time) => {
    const index = {url: '/notes', category: 'index', type: 'application/json'};
    const put = {url: '/notes/1', method: 'PUT', send: JSON.stringify({note: {id: 1, text: 'New text'}}), category: 'update', type: 'application/json'};

    const response = {
      body: [
        {id: 0, text: 'Hello world'},
        {id: 1, text: 'What a test'}
      ]
    };

    const textChangeEvent = {target: {value: 'New text'}};

    const response$        = Time.diagram('-r------', {r: xs.of(response)})
    const textChange$      = Time.diagram('---t----', {t: textChangeEvent});
    const expectedRequest$ = Time.diagram('i-----p-', {i: index, p: put});

    const DOM = mockDOMSource({
      '.___Note-1': {
        '.foo': {
          'change': textChange$
        }
      }
    });

    const HTTP = mockHTTPSource({
      'index': response$
    });

    const collection = RestCollection(Note, {Time, DOM, HTTP}, '/notes');

    Time.assertEqual(
      collection.HTTP,
      expectedRequest$
    );
  }));

  it('handles local creation with existing items', t((Time) => {
    const index = {url: '/notes', category: 'index', type: 'application/json'};
    const create = {url: '/notes', method: 'POST', send: JSON.stringify({note: {text: 'A new one'}}), tempId: `temp-1`, category: 'create', type: 'application/json'};

    const indexResponse = {
      body: [
        {id: 0, text: 'Hello world'},
        {id: 1, text: 'What a test'}
      ]
    };

    const createResponse = {
      body: {id: 2, text: 'A new one'},
    };

    const createResponse$ = xs.of(createResponse);
    createResponse$['request'] = create;

    const initialItemText = indexResponse.body.map(a => a.text);

    const indexResponse$$  = Time.diagram('--r------', {r: xs.of(indexResponse)})
    const createResponse$$ = Time.diagram('------r--', {r: createResponse$})
    const add$             = Time.diagram('----a----', {a: {state$: xs.of({text: 'A new one'})}});
    const expectedRequest$ = Time.diagram('i---c----', {i: index, c: create});
    const expectedText$    = Time.diagram('a-b-c-c--', {a: [], b: initialItemText, c: initialItemText.concat('A new one')});

    const DOM = mockDOMSource({});

    const HTTP = mockHTTPSource({
      'index': indexResponse$$,
      'create': createResponse$$
    });

    const collection = RestCollection(Note, {Time, DOM, HTTP, add$}, '/notes');

    Time.assertEqual(
      collection.HTTP,
      expectedRequest$
    );

    Time.assertEqual(
      collection.pluck(note => note.DOM).map(vtrees => vtrees.map(vtree => select('.text', vtree)[0].text)),
      expectedText$
    );
  }));
});

