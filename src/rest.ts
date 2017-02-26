import xs from 'xstream';
import concat from 'xstream/extra/concat';
import isolate from '@cycle/isolate';

function loadComponent (state, componentData) {
  const componentState$ = componentData.state$;
  let id = componentData.id;

  if (id === null || id === undefined) {
    id = componentData.tempId;
  }

  const instance = isolate(state.component, `${state.component.name}-${id}`)({...state.sources, ...componentData});

  instance['_id'] = id;

  return {
    ...state,

    stateSources: {
      ...state.stateSources,

      [id]: componentState$
    },

    items: [
      ...state.items,

      instance
    ]
  }
}

function loadComponentsFromIndex (data) {
  return function reduce (state) {
    return data.map(v => ({id: v.id, state$: xs.of(v)})).reduce(loadComponent, state);
  }
}

function addComponent (componentData) {
  return function reduce (state) {
    return loadComponent(state, componentData);
  }
}

function applyReducer (state, reducer) {
  return reducer(state);
}

function createRequest (endpoint) {
  return function (data) {
    const dataToSend = {};

    Object.keys(data).filter(key => key !== 'tempId').forEach(key => dataToSend[key] = data[key]);

    return {
      method: 'POST',
      url: endpoint,
      tempId: data.tempId,
      send: JSON.stringify(dataToSend)
    }
  }
}

function createSuccess (data) {
  return function reduce (state) {

    const stateSource = state.stateSources[data.tempIdToUpdate];

    stateSource.shamefullySendNext(data.items);

    delete state.stateSources[data.tempIdToUpdate];

    return {
      ...state,

      stateSources: {
        [data.items.id]: stateSource
      },

      items: state.items
    }
  }
}

function updateRequest (endpoint) {
  return function (data) {
    return {
      url: `${endpoint}/${data.id}`,
      method: 'PUT',
      send: JSON.stringify(data)
    }
  }
}

function makeIder () {
  let i = 0;

  return function getId () {
    return `temp-${i++}`;
  }
}

const id = makeIder();

function tempId () {
  const tempId = id();

  return function (state) {
    return {
      ...state,

      tempId
    }
  }
}

function RestCollection (component, sources, endpoint) {
  const add$ = sources.add$ || xs.empty();
  const addWithTemporaryId$ = add$.map(a => {
    const applyId = tempId();

    return applyId({
      ...a,

      state$: a.state$.map(applyId).remember()
    });
  });

  const initialRequest = {
    url: endpoint
  }

  const initialState = {
    items: [],
    component,
    sources,
    stateSources: {}
  };

  const index$ = sources.HTTP.select('index').flatten().map(a => a.items);
  const loadComponentsFromIndex$ = index$.map(loadComponentsFromIndex);

  const createSuccess$ = sources.HTTP.select('create').map(response$ => {
    const tempIdToUpdate = response$.request.tempId;

    return response$.map(data => ({...data, tempIdToUpdate}));
  })
    .flatten()
    .map(createSuccess);

  const addLocalComponent$ = addWithTemporaryId$.map(addComponent);

  const reducer$ = xs.merge(
    loadComponentsFromIndex$,
    addLocalComponent$,
    createSuccess$
  );

  const state$ = reducer$.fold(applyReducer, initialState);
  const items$ = state$.map(state => state.items);

  function merge (selector) {
    const stuff = {};

    function sink (item) {
      if (item._id in stuff) {
        return stuff[item._id];
      }

      const stream = selector(item);

      stuff[item._id] = stream;

      return stream;
    }

    return items$
      .map(items => items.map(sink))
      .map(streams => xs.merge(...streams))
      .flatten();
  }

  const request$ = xs.merge(
    xs.of(initialRequest),

    merge(component => component.state$.drop(1)).map(updateRequest(endpoint)),

    addWithTemporaryId$.map(add => add.state$.take(1)).flatten().map(createRequest(endpoint))
  );

  return {
    HTTP: request$,

    pluck (selector) {
      return items$
        .map(items => items.map(selector))
        .map(selectedItems => xs.combine(...selectedItems))
        .flatten();
    }
  }
}

export {
  RestCollection
}
