import xs from 'xstream';
import concat from 'xstream/extra/concat';
import isolate from '@cycle/isolate';

function always (stream) {
  return xs.create({
    start (listener) {
      stream.addListener({
        next (ev) {
          listener.next(ev);
        }
      })
    },

    stop () {}
  });
}

function memoize (f, remember = true) {
  return function (selector) {
    const cache = {};

    function sink (item) {
      if (item._id in cache) {
        return cache[item._id];
      }

      let stream = selector(item);

      if (remember) {
        stream = stream.remember();
      }

      cache[item._id] = stream;

      return stream;
    }

    return f(sink);
  }
}

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
    return loadComponent(state, {...componentData, state$: xs.merge(componentData.state$, xs.never())});
  }
}

function applyReducer (state, reducer) {
  return reducer(state);
}

function createRequest (endpoint, name) {
  return function (data) {
    const dataToSend = {};

    Object.keys(data).filter(key => key !== 'tempId').forEach(key => dataToSend[key] = data[key]);

    return {
      method: 'POST',
      url: endpoint,
      tempId: data.tempId,
      send: JSON.stringify({[name]: dataToSend}),
      category: 'create'
    }
  }
}

function createSuccess (data) {
  return function reduce (state) {

    const stateSource = state.stateSources[data.tempIdToUpdate];

    stateSource.shamefullySendNext(data.body);

    delete state.stateSources[data.tempIdToUpdate];

    return {
      ...state,

      stateSources: {
        [data.body.id]: stateSource
      },

      items: state.items
    }
  }
}

function updateRequest (endpoint, name) {
  return function (data) {
    return {
      url: `${endpoint}/${data.id}`,
      method: 'PUT',
      send: JSON.stringify({[name]: data}),
      category: 'update'
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
    url: endpoint,
    category: 'index'
  }

  const initialState = {
    items: [],
    component,
    sources,
    stateSources: {}
  };

  const index$ = sources.HTTP.select('index').flatten().map(response => response.body);
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
    addLocalComponent$.debug('hi'),
    createSuccess$
  );

  const state$ = reducer$.fold(applyReducer, initialState);
  const items$ = state$.map(state => state.items).debug('components');

  const merge = memoize(function (selector) {
    return items$
      .map(items => items.map(selector))
      .map(streams => xs.merge(...streams))
      .flatten();
  }, false);

  const pluck = memoize(function (selector) {
    return items$
      .map(items => items.map(selector))
      .map(selectedItems => xs.combine(...selectedItems))
      .flatten();
  });

  const update$ = merge(item =>
    item.state$
      .drop(1)
      .compose(sources.Time.debounce(300))
      .map(updateRequest(endpoint, component.name.toLowerCase()))
  )

  const request$ = xs.merge(
    xs.of(initialRequest),

    update$,

    addWithTemporaryId$
      .map(add => add.state$.take(1))
      .flatten()
      .map(createRequest(endpoint, component.name.toLowerCase()))
  );

  return {
    HTTP: request$.map(req => ({...req, type: 'application/json'})),
    pluck,
    merge
  }
}

export {
  RestCollection
}
