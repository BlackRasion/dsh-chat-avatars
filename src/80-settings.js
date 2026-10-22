/**
 * @module 80-settings
 * 职责：Settings → 聊天头像整页——总开关/外观/显示范围/全局默认/工作区覆盖/数据工具/诊断。
 * 依赖：store / image / i18n / contract / status / storage（版本等）。
 * 被依赖：apply（注册到 contract.slots.settings）。
 * 状态：M1-4 迁移 0.1.0 设置页；M2 起上传改为 55-crop 裁剪对话框 + 50-image 输出管线，
 *       数据工具与诊断复用 store/status。
 */
function cssUrl(dataUrl) {
  return 'url("' + dataUrl + '")';
}

/** 设置页诊断投影（不含头像数据本体）。 */
function buildSettingsDiagnostics(snapshot) {
  const current = snapshot || {};
  const data = current.data || null;
  return {
    plugin: PACKAGE_NAME,
    build: CONTRACT.build,
    host: current.host ? { version: current.host.version, commit: current.host.commit } : null,
    tested: CONTRACT.testedDsh.slice(),
    supportedRange: CONTRACT.supportedRange,
    versionStatus: current.versionStatus || 'unknown',
    contract: current.contract || 'unknown',
    paused: current.paused || null,
    pauseReasons: current.pauseReasons ? current.pauseReasons.slice() : [],
    override: !!current.override,
    storage: {
      available: current.storageAvailable !== false,
      readonly: !!current.readonly,
      bytes: estimateBytes(data),
      schemaVersion: SCHEMA_VERSION,
      lastWriteError: current.lastWriteError || null,
      warnings: current.warnings ? current.warnings.slice() : []
    },
    settings: data ? data.settings : null,
    workspaceEntries: data ? Object.keys(data.workspaces).length : 0,
    animatedAvatars: countAnimatedAvatars(data),
    checkedAt: isoNow()
  };
}

// @chat-avatars-settings-orphans:start
/**
 * 计算可清理的工作区头像 id。
 * 安全门禁：工作区列表未就绪（useWorkspaces 缺失/抛错/非数组）时返回 []，
 * 调用方必须据此禁用清理按钮——否则 validIds=[] 会删除全部工作区覆盖（数据丢失）。
 */
function orphanWorkspaceIds(workspacesReady, storedIds, validIds) {
  if (!workspacesReady || !Array.isArray(storedIds) || !Array.isArray(validIds)) return [];
  const valid = new Set(
    validIds
      .filter(function (id) {
        return id !== undefined && id !== null;
      })
      .map(function (id) {
        return String(id);
      })
  );
  return storedIds.filter(function (id) {
    return !valid.has(String(id));
  });
}
// @chat-avatars-settings-orphans:end

function Button(props) {
  return h(
    'button',
    {
      type: 'button',
      className: 'dsh-av-btn' + (props.danger ? ' dsh-av-btn-danger' : ''),
      disabled: props.disabled,
      onClick: props.onClick,
      title: props.title
    },
    props.children
  );
}

function Switch(props) {
  return h(
    'button',
    {
      type: 'button',
      role: 'switch',
      'aria-checked': props.checked ? 'true' : 'false',
      'aria-label': props.label,
      className: 'dsh-av-switch' + (props.checked ? ' is-on' : ''),
      onClick: function () {
        props.onChange(!props.checked);
      }
    },
    h('span', { className: 'dsh-av-switch-knob' })
  );
}

function Field(props) {
  return h(
    'div',
    { className: 'dsh-av-row' },
    h('span', { className: 'dsh-av-row-label' }, props.label),
    h('div', { className: 'dsh-av-row-control' }, props.children)
  );
}

function Card(props) {
  return h(
    'section',
    { className: 'dsh-av-card' },
    props.title ? h('div', { className: 'dsh-av-card-title' }, props.title) : null,
    props.hint ? h('div', { className: 'dsh-av-hint' }, props.hint) : null,
    props.children
  );
}

/** 可折叠 Card：标题行是 button（aria-expanded/aria-controls），键盘 Enter/Space 可切换。 */
function CollapsibleCard(props) {
  const bodyId = props.bodyId || 'dsh-av-card-body';
  return h(
    'section',
    { className: 'dsh-av-card' + (props.open ? '' : ' is-collapsed') },
    h(
      'button',
      {
        type: 'button',
        className: 'dsh-av-card-head',
        'aria-expanded': props.open ? 'true' : 'false',
        'aria-controls': bodyId,
        onClick: function () {
          try {
            if (props.onToggle) props.onToggle();
          } catch (error) {}
        }
      },
      h('span', { className: 'dsh-av-card-title' }, props.title),
      typeof props.count === 'number' ? h('span', { className: 'dsh-av-card-count' }, String(props.count)) : null,
      h('span', { className: 'dsh-av-card-chevron', 'aria-hidden': 'true' }, '▾')
    ),
    props.open
      ? h(
          'div',
          { id: bodyId, className: 'dsh-av-card-body' },
          props.hint ? h('div', { className: 'dsh-av-hint' }, props.hint) : null,
          props.children
        )
      : null
  );
}

function AvatarSlot(props) {
  const inputRef = React.useRef(null);
  // M5：头像值可能是静态 data URL 字符串或 { kind:'animated', src, frames, frameMs }。
  const animated = props.image && typeof props.image === 'object' ? props.image : null;
  const imageSrc = animated ? animated.src : props.image || null;
  const letter = imageSrc ? '' : props.side === 'user' ? t('default.user') : t('default.assistant');
  const previewStyle = {
    backgroundImage: imageSrc
      ? cssUrl(imageSrc)
      : props.side === 'user'
        ? 'linear-gradient(135deg, rgba(255, 255, 255, .10), rgba(255, 255, 255, 0) 55%, rgba(0, 0, 0, .12))'
        : 'linear-gradient(135deg, rgba(255, 255, 255, .14), rgba(255, 255, 255, 0) 55%, rgba(0, 0, 0, .08))',
    // 动图预览显示雪碧图首帧（auto 100% + 0 0），静态仍为 cover 居中。
    backgroundSize: animated ? 'auto 100%' : 'cover',
    backgroundPosition: animated ? '0 0' : 'center',
    backgroundColor: props.side === 'user' ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-bg-layer-2)',
    color: props.side === 'user' ? 'var(--dsw-alias-bg-base)' : 'var(--dsw-alias-label-primary)',
    borderRadius: props.shape === 'rounded' ? '7px' : '999px'
  };
  return h(
    'div',
    { className: 'dsh-av-slot' },
    h('div', { className: 'dsh-av-preview', style: previewStyle, 'aria-hidden': 'true' }, letter),
    h(
      'div',
      { className: 'dsh-av-slot-main' },
      h(
        'div',
        { className: 'dsh-av-slot-label' },
        props.label,
        // M5-5：动图标识留在文字旁但弱化（次要色小字 + 8px 间距，无边框/背景）。
        animated ? h('span', { className: 'dsh-av-tag-weak' }, ' ' + t('animatedTag')) : null
      ),
      h(
        'div',
        { className: 'dsh-av-slot-actions' },
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-av-btn',
            onClick: function () {
              try {
                if (inputRef.current) inputRef.current.click();
              } catch (error) {}
            }
          },
          imageSrc ? t('replace') : t('upload')
        ),
        imageSrc
          ? h(
              'button',
              {
                type: 'button',
                className: 'dsh-av-btn',
                onClick: function () {
                  props.onClear();
                }
              },
              t('clear')
            )
          : null,
        props.onRestore
          ? h(
              'button',
              {
                type: 'button',
                className: 'dsh-av-btn',
                onClick: function () {
                  props.onRestore();
                }
              },
              t('restoreInherit')
            )
          : null
      ),
      h('input', {
        ref: inputRef,
        type: 'file',
        accept: 'image/png,image/jpeg,image/webp,image/gif',
        style: { display: 'none' },
        onChange: function (event) {
          const input = event.target;
          const file = input.files && input.files[0];
          try {
            input.value = '';
          } catch (error) {}
          if (file) props.onPick(file);
        }
      })
    )
  );
}

function WorkspaceRow(props) {
  const workspace = props.workspace || {};
  const entry = props.entry || { user: null, assistant: null };
  const customized = !!(entry.user || entry.assistant);
  const current =
    props.currentWorkspaceId !== null &&
    props.currentWorkspaceId !== undefined &&
    String(props.currentWorkspaceId) === String(workspace.workspaceId);
  return h(
    'div',
    { className: 'dsh-av-ws' + (current ? ' is-current' : '') },
    h(
      'div',
      { className: 'dsh-av-ws-head' },
      h(
        'div',
        { className: 'dsh-av-ws-title' },
        String(workspace.title || workspace.workspaceId || ''),
        current ? h('span', { className: 'dsh-av-tag' }, t('workspace.current')) : null
      ),
      h('div', { className: 'dsh-av-ws-status' }, customized ? t('customized') : t('inherited'))
    ),
    h(AvatarSlot, {
      side: 'user',
      shape: props.shape,
      label: t('slot.user'),
      image: entry.user || null,
      onPick: function (file) {
        props.onPick('user', file);
      },
      onClear: function () {
        props.onClear('user');
      },
      onRestore: customized
        ? function () {
            props.onRestore();
          }
        : undefined
    }),
    h(AvatarSlot, {
      side: 'assistant',
      shape: props.shape,
      label: t('slot.assistant'),
      image: entry.assistant || null,
      onPick: function (file) {
        props.onPick('assistant', file);
      },
      onClear: function () {
        props.onClear('assistant');
      }
    })
  );
}

function Banner(props) {
  const snapshot = props.snapshot || {};
  const items = [];
  if (snapshot.paused === 'E_CONTRACT') items.push(t('banner.contract'));
  else if (snapshot.paused === 'E_VERSION_UNSUPPORTED') items.push(t('banner.unsupported'));
  if (snapshot.versionStatus === 'unverified') items.push(t('banner.unverified'));
  if (snapshot.storageAvailable === false) items.push(t('banner.storage'));
  if (snapshot.readonly) items.push(t('banner.readonly'));
  if (snapshot.lastWriteError) items.push(t('banner.writeError') + ' (' + snapshot.lastWriteError + ')');
  if (snapshot.warnings && snapshot.warnings.length > 0) items.push(t('banner.badData'));
  if (snapshot.override) items.push(t('banner.override'));
  if (items.length === 0) return null;
  const actions = [];
  actions.push(h(Button, { key: 'retry', onClick: props.onRetry }, t('retryProbe')));
  if (snapshot.paused === 'E_CONTRACT' && !snapshot.override) {
    actions.push(h(Button, { key: 'override', onClick: props.onOverride }, t('overrideProbe')));
  }
  if (snapshot.override) {
    actions.push(h(Button, { key: 'auto', onClick: props.onAuto }, t('restoreAutoProbe')));
  }
  return h(
    'div',
    { className: 'dsh-av-banner', role: 'status' },
    h(
      'div',
      { className: 'dsh-av-banner-list' },
      items.map(function (text, index) {
        return h('div', { key: String(index) }, text);
      })
    ),
    h('div', { className: 'dsh-av-banner-actions' }, actions)
  );
}

function SettingsSection(props) {
  const store = React.useMemo(function () {
    return createStore();
  }, []);
  const snapshot = useStoreSnapshot();
  useLocaleId();
  const busyState = React.useState(null);
  const busy = busyState[0];
  const setBusy = busyState[1];
  const noticeState = React.useState(null);
  const notice = noticeState[0];
  const setNotice = noticeState[1];
  const clearState = React.useState(false);
  const confirmClear = clearState[0];
  const setConfirmClear = clearState[1];
  const orphanConfirmState = React.useState(false);
  const confirmOrphans = orphanConfirmState[0];
  const setConfirmOrphans = orphanConfirmState[1];
  const orphanTimerRef = React.useRef(0);
  // 组件卸载后禁止再写 store/setState（上传/烘焙 Promise 可能在卸载后才完成）。
  const mountedRef = React.useRef(true);
  const importRef = React.useRef(null);
  const cropRef = React.useRef(null);
  const cropState = React.useState(null);
  const cropRequest = cropState[0];
  const setCropRequest = cropState[1];
  const cropIdRef = React.useRef(0);
  const closeCropSource = React.useCallback(function (request) {
    try {
      if (request && request.source && typeof request.source.close === 'function') request.source.close();
    } catch (error) {}
  }, []);
  const setCrop = React.useCallback(function (next) {
    const previous = cropRef.current;
    if (previous === next) return;
    cropRef.current = next;
    if (previous) closeCropSource(previous);
    setCropRequest(next);
  }, [closeCropSource, setCropRequest]);
  React.useEffect(function () {
    mountedRef.current = true;
    return function () {
      mountedRef.current = false;
      if (orphanTimerRef.current) {
        try {
          clearTimeout(orphanTimerRef.current);
        } catch (error) {}
        orphanTimerRef.current = 0;
      }
      const previous = cropRef.current;
      cropRef.current = null;
      if (previous) closeCropSource(previous);
    };
  }, [closeCropSource]);
  const selectItems = React.useCallback(function (workspaceSnapshot) {
    return workspaceSnapshot && Array.isArray(workspaceSnapshot.items) ? workspaceSnapshot.items : [];
  }, []);
  let workspacesReady = false;
  let rawWorkspaces = [];
  try {
    if (props && typeof props.useWorkspaces === 'function') {
      rawWorkspaces = props.useWorkspaces(selectItems);
      workspacesReady = Array.isArray(rawWorkspaces);
    }
  } catch (error) {
    rawWorkspaces = [];
    workspacesReady = false;
  }
  const workspaces = React.useMemo(
    function () {
      const list = Array.isArray(rawWorkspaces) ? rawWorkspaces.slice() : [];
      list.sort(function (left, right) {
        return String((left && left.title) || '').localeCompare(String((right && right.title) || ''));
      });
      return list;
    },
    [rawWorkspaces]
  );
  React.useEffect(function () {
    try {
      store.requestProbe();
    } catch (error) {}
  }, []);

  const messageForResult = React.useCallback(function (result) {
    if (result && result.ok === false) {
      setNotice({ kind: 'error', text: messageForCode(result.code) });
      return false;
    }
    return true;
  }, []);

  // M5-5：尺寸滑块高频预览——只走内存 store 通知（不写盘），200ms 合并后落盘；
  // pointerup/keyup/blur/卸载立即 flush，避免拖动过程中反复 stringify 含动图的整份 JSON。
  const sizeTimerRef = React.useRef(null);
  const pendingSizeRef = React.useRef(null);
  const sizePreviewFrameRef = React.useRef(0);
  const commitSize = React.useCallback(
    function () {
      const value = pendingSizeRef.current;
      pendingSizeRef.current = null;
      if (sizePreviewFrameRef.current) {
        try {
          cancelAnimationFrame(sizePreviewFrameRef.current);
        } catch (error) {}
        sizePreviewFrameRef.current = 0;
      }
      if (sizeTimerRef.current) {
        try {
          clearTimeout(sizeTimerRef.current);
        } catch (error) {}
        sizeTimerRef.current = null;
      }
      if (value === null || value === undefined) return;
      messageForResult(store.setSettings({ size: value }));
    },
    [store, messageForResult]
  );
  const previewSize = React.useCallback(
    function (value) {
      const next = Number(value);
      if (!Number.isInteger(next)) return;
      pendingSizeRef.current = next;
      // 同一帧内的多次 input 合并成一次内存预览（避免拖动时每个事件都触发 bridge 重渲染）。
      if (typeof requestAnimationFrame === 'function') {
        if (!sizePreviewFrameRef.current) {
          sizePreviewFrameRef.current = requestAnimationFrame(function () {
            sizePreviewFrameRef.current = 0;
            const latest = pendingSizeRef.current;
            if (latest === null || latest === undefined) return;
            const result = store.previewSize(latest);
            if (result && result.ok === false) {
              setNotice({ kind: 'error', text: messageForCode(result.code) });
            }
          });
        }
      } else {
        const result = store.previewSize(next);
        if (result && result.ok === false) {
          setNotice({ kind: 'error', text: messageForCode(result.code) });
          return;
        }
      }
      if (sizeTimerRef.current) {
        try {
          clearTimeout(sizeTimerRef.current);
        } catch (error) {}
      }
      sizeTimerRef.current = setTimeout(commitSize, 200);
    },
    [store, commitSize]
  );
  React.useEffect(
    function () {
      return function () {
        try {
          commitSize();
        } catch (error) {}
      };
    },
    [commitSize]
  );

  const run = React.useCallback(function (label, operation) {
    if (!mountedRef.current) return;
    setBusy(label || '...');
    setNotice(null);
    Promise.resolve()
      .then(operation)
      .catch(function (error) {
        if (mountedRef.current) setNotice({ kind: 'error', text: messageForCode(codeOf(error)) });
      })
      .then(function () {
        if (mountedRef.current) setBusy(null);
      });
  }, []);

  const data = snapshot && snapshot.data ? snapshot.data : defaultData();
  const settings = data.settings || DEFAULT_SETTINGS;
  const currentWorkspaceId = snapshot ? snapshot.currentWorkspaceId : null;

  const handlePick = function (scope, side) {
    return function (file) {
      if (!file) return;
      run(t('busy.upload'), function () {
        return prepareAvatarFile(file).then(function (prepared) {
          // 卸载竞态：组件已卸载时释放刚解码的 source，不写入 state。
          if (!mountedRef.current) {
            closeCropSource(prepared);
            return;
          }
          cropIdRef.current += 1;
          setCrop({
            id: cropIdRef.current,
            scope: scope,
            side: side,
            kind: prepared.kind,
            source: prepared.source,
            width: prepared.width,
            height: prepared.height,
            plan: prepared.plan || null,
            job: prepared.job || null
          });
        });
      });
    };
  };

  const handleApplyCrop = function (rect) {
    const request = cropRef.current;
    if (!request) return;
    const animated = request.kind === 'animated';
    run(animated ? t('busy.processingAnim') : t('busy.upload'), function () {
      const produced = animated
        ? bakeAnimationSprite(request.job, rect)
        : processImageSource(request.source, rect);
      return produced
        .then(function (value) {
          // 卸载竞态：bake/process 完成时若组件已卸载，只释放 source，不写 store/setState。
          if (!mountedRef.current) {
            closeCropSource(request);
            return;
          }
          const result = store.setAvatar(request.scope, request.side, value);
          if (messageForResult(result)) setNotice({ kind: 'info', text: t('notice.uploaded') });
        })
        .then(
          function () {
            if (mountedRef.current) setCrop(null);
          },
          function (error) {
            if (mountedRef.current) setCrop(null);
            throw error;
          }
        );
    });
  };

  const handleCancelCrop = function () {
    setCrop(null);
  };

  const handleClear = function (scope, side) {
    return function () {
      const result = store.setAvatar(scope, side, null);
      messageForResult(result);
    };
  };

  const handleChange = function (patch) {
    const result = store.setSettings(patch);
    messageForResult(result);
  };

  // M7：拍一拍设置。文案 500ms 防抖落盘 + blur/卸载 flush；音量本地预览、松手落盘。
  const settingsPoke =
    settings && settings.poke && typeof settings.poke === 'object' ? settings.poke : DEFAULT_SETTINGS.poke;
  const settingsPokeRef = React.useRef(settingsPoke);
  settingsPokeRef.current = settingsPoke;
  const updatePoke = React.useCallback(
    function (patch) {
      const base = settingsPokeRef.current && typeof settingsPokeRef.current === 'object' ? settingsPokeRef.current : {};
      const result = store.setSettings({ poke: Object.assign({}, base, patch) });
      messageForResult(result);
    },
    [messageForResult]
  );
  const pokeDraftState = React.useState({ userText: '', assistantText: '' });
  const pokeDraft = pokeDraftState[0];
  const setPokeDraft = pokeDraftState[1];
  const pokeDraftRef = React.useRef(pokeDraft);
  pokeDraftRef.current = pokeDraft;
  const pokeTextTimerRef = React.useRef(null);
  const pokeTextPendingRef = React.useRef(null);
  React.useEffect(
    function () {
      setPokeDraft({ userText: settingsPoke.userText || '', assistantText: settingsPoke.assistantText || '' });
    },
    [settingsPoke.userText, settingsPoke.assistantText]
  );
  const flushPokeText = React.useCallback(
    function () {
      if (pokeTextTimerRef.current) {
        try {
          clearTimeout(pokeTextTimerRef.current);
        } catch (error) {}
        pokeTextTimerRef.current = null;
      }
      const pending = pokeTextPendingRef.current;
      pokeTextPendingRef.current = null;
      if (!pending) return;
      updatePoke({ userText: pending.userText || '', assistantText: pending.assistantText || '' });
    },
    [updatePoke]
  );
  React.useEffect(
    function () {
      return function () {
        flushPokeText();
      };
    },
    [flushPokeText]
  );
  const onPokeTextChange = function (field) {
    return function (event) {
      const value = event && event.target ? String(event.target.value || '') : '';
      const next = Object.assign({}, pokeDraftRef.current, { [field]: value });
      pokeDraftRef.current = next;
      setPokeDraft(next);
      pokeTextPendingRef.current = next;
      if (pokeTextTimerRef.current) {
        try {
          clearTimeout(pokeTextTimerRef.current);
        } catch (error) {}
      }
      pokeTextTimerRef.current = setTimeout(flushPokeText, 500);
    };
  };
  const volumeState = React.useState(60);
  const volumeDraft = volumeState[0];
  const setVolumeDraft = volumeState[1];
  React.useEffect(
    function () {
      setVolumeDraft(settingsPoke.volume === undefined ? 60 : settingsPoke.volume);
    },
    [settingsPoke.volume]
  );
  const commitVolume = function () {
    updatePoke({ volume: volumeDraft });
  };
  const handleTestPokeSound = function () {
    playPokeSound(volumeDraft);
  };

  // M7 打磨：工作区覆盖卡默认折叠；状态写入设置，随数据持久化/多标签同步。
  const workspacesCollapsed = settings.workspacesCollapsed !== false;
  const handleToggleWorkspaces = function () {
    handleChange({ workspacesCollapsed: !workspacesCollapsed });
  };

  const handleExport = function () {
    run(t('busy.export'), function () {
      try {
        const payload = store.buildExport();
        const text = JSON.stringify(payload, null, 2);
        const blob = new Blob([text], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        const stamp = String(isoNow() || '').slice(0, 10).replace(/-/g, '');
        anchor.href = url;
        anchor.download = 'dsh-chat-avatars-backup-' + stamp + '.json';
        anchor.click();
        setTimeout(function () {
          try {
            URL.revokeObjectURL(url);
          } catch (error) {}
        }, 1000);
        setNotice({ kind: 'info', text: t('notice.exported') });
      } catch (error) {
        throw makeError('E_ENCODE');
      }
    });
  };

  const handleImportFile = function (file) {
    if (!file) return;
    run(t('busy.import'), function () {
      const read =
        typeof file.text === 'function'
          ? file.text()
          : new Promise(function (resolve, reject) {
              try {
                const reader = new FileReader();
                reader.onload = function () {
                  resolve(String(reader.result || ''));
                };
                reader.onerror = function () {
                  reject(makeError('E_IMPORT_INVALID'));
                };
                reader.readAsText(file);
              } catch (error) {
                reject(makeError('E_IMPORT_INVALID'));
              }
            });
      return read.then(function (text) {
        const imported = store.parseImport(text);
        const message = t('import.confirm')
          .replace('{images}', String(imported.images))
          .replace('{workspaces}', String(imported.workspaces));
        let confirmed = false;
        try {
          confirmed = window.confirm(message);
        } catch (error) {
          confirmed = false;
        }
        if (!confirmed) return;
        const result = store.replaceAllData(imported.data);
        if (messageForResult(result)) setNotice({ kind: 'info', text: t('notice.imported') });
      });
    });
  };

  const handleClearAll = function () {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(function () {
        setConfirmClear(false);
      }, 4000);
      return;
    }
    setConfirmClear(false);
    const result = store.clearAllData();
    if (messageForResult(result)) setNotice({ kind: 'info', text: t('notice.cleared') });
  };

  const validIds = workspaces
    .map(function (workspace) {
      return workspace && workspace.workspaceId;
    })
    .filter(function (id) {
      return id !== undefined && id !== null;
    });
  const beforeOrphans = Object.keys(data.workspaces).length;
  // 安全门禁：工作区列表未加载/异常时 validIds 不可信，禁止清理（否则会删掉全部工作区覆盖）。
  const orphanIds = orphanWorkspaceIds(workspacesReady, Object.keys(data.workspaces), validIds);
  const orphanCount = orphanIds.length;
  const handleCleanOrphans = function () {
    if (!workspacesReady) {
      setNotice({ kind: 'error', text: t('notice.orphansUnavailable') });
      return;
    }
    if (orphanCount === 0) return;
    if (!confirmOrphans) {
      setConfirmOrphans(true);
      if (orphanTimerRef.current) {
        try {
          clearTimeout(orphanTimerRef.current);
        } catch (error) {}
      }
      orphanTimerRef.current = setTimeout(function () {
        orphanTimerRef.current = 0;
        if (mountedRef.current) setConfirmOrphans(false);
      }, 4000);
      return;
    }
    setConfirmOrphans(false);
    if (orphanTimerRef.current) {
      try {
        clearTimeout(orphanTimerRef.current);
      } catch (error) {}
      orphanTimerRef.current = 0;
    }
    const result = store.removeOrphanWorkspaces(validIds);
    if (messageForResult(result)) {
      const state = store.getState();
      const after = state && state.data ? Object.keys(state.data.workspaces).length : 0;
      setNotice({
        kind: 'info',
        text: t('notice.orphans') + (beforeOrphans !== after ? ' (' + String(beforeOrphans - after) + ')' : '')
      });
    }
  };

  const handleCopyDiagnostics = function () {
    try {
      const text = JSON.stringify(buildSettingsDiagnostics(snapshot), null, 2);
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(text).then(
          function () {
            setNotice({ kind: 'info', text: t('notice.copied') });
          },
          function () {}
        );
      }
    } catch (error) {}
  };

  const handleRetry = function () {
    store.requestProbe();
    setNotice(null);
  };
  const handleOverride = function () {
    store.setOverride(true);
  };
  const handleAuto = function () {
    store.setOverride(false);
  };

  const shapeOptions = [
    { value: 'circle', label: t('circle') },
    { value: 'rounded', label: t('rounded') }
  ];
  const aiModeOptions = [
    { value: 'every-step', label: t('aiMode.everyStep') },
    { value: 'first-per-turn', label: t('aiMode.firstPerTurn') }
  ];

  return h(
    'div',
    { className: 'dsh-av-settings' },
    h(Banner, {
      snapshot: snapshot || {},
      onRetry: handleRetry,
      onOverride: handleOverride,
      onAuto: handleAuto
    }),
    h(
      Card,
      { title: t('appearance'), hint: t('interaction.hint') },
      h(Field, { label: t('enabled') }, h(Switch, {
        checked: !!settings.enabled,
        label: t('enabled'),
        onChange: function (value) {
          handleChange({ enabled: value });
        }
      })),
      h(Field, { label: t('size') }, h('div', { className: 'dsh-av-slider-row' },
        h('input', {
          type: 'range',
          className: 'dsh-av-slider',
          min: SIZE_MIN,
          max: SIZE_MAX,
          step: 1,
          value: String(settings.size),
          disabled: !!(snapshot && snapshot.readonly),
          'aria-label': t('size'),
          'aria-valuetext': String(settings.size) + ' px',
          onChange: function (event) {
            previewSize(Number(event.target.value));
          },
          onPointerUp: commitSize,
          onKeyUp: commitSize,
          onBlur: commitSize
        }),
        h('output', { className: 'dsh-av-slider-value' }, String(settings.size) + ' px')
      )),
      h(Field, { label: t('shape') }, h('select', {
        className: 'dsh-av-select',
        value: settings.shape,
        'aria-label': t('shape'),
        onChange: function (event) {
          handleChange({ shape: event.target.value });
        }
      }, shapeOptions.map(function (option) {
        return h('option', { key: option.value, value: option.value }, option.label);
      }))),
      h(Field, { label: t('aiAvatarMode') }, h('select', {
        className: 'dsh-av-select',
        value: settings.aiAvatarMode || 'every-step',
        'aria-label': t('aiAvatarMode'),
        onChange: function (event) {
          handleChange({ aiAvatarMode: event.target.value });
        }
      }, aiModeOptions.map(function (option) {
        return h('option', { key: option.value, value: option.value }, option.label);
      }))),
      h('div', { className: 'dsh-av-hint' }, t('aiMode.hint')),
      h(Field, { label: t('showUser') }, h(Switch, {
        checked: !!settings.showUser,
        label: t('showUser'),
        onChange: function (value) {
          handleChange({ showUser: value });
        }
      })),
      h(Field, { label: t('showAssistant') }, h(Switch, {
        checked: !!settings.showAssistant,
        label: t('showAssistant'),
        onChange: function (value) {
          handleChange({ showAssistant: value });
        }
      }))
    ),
    h(
      Card,
      { title: t('interaction.card'), hint: t('poke.hint') },
      h(Field, { label: t('poke.enabled') }, h(Switch, {
        checked: settingsPoke.enabled !== false,
        label: t('poke.enabled'),
        onChange: function (value) {
          updatePoke({ enabled: value });
        }
      })),
      h(Field, { label: t('poke.userText') }, h('input', {
        type: 'text',
        className: 'dsh-av-text',
        maxLength: 40,
        value: pokeDraft.userText,
        placeholder: t('poke.defaultUser'),
        'aria-label': t('poke.userText'),
        disabled: !!(snapshot && snapshot.readonly),
        onChange: onPokeTextChange('userText'),
        onBlur: flushPokeText
      })),
      h(Field, { label: t('poke.assistantText') }, h('input', {
        type: 'text',
        className: 'dsh-av-text',
        maxLength: 40,
        value: pokeDraft.assistantText,
        placeholder: t('poke.defaultAssistant'),
        'aria-label': t('poke.assistantText'),
        disabled: !!(snapshot && snapshot.readonly),
        onChange: onPokeTextChange('assistantText'),
        onBlur: flushPokeText
      })),
      h('div', { className: 'dsh-av-hint' }, t('poke.textHint')),
      h(Field, { label: t('poke.sound') }, h(Switch, {
        checked: settingsPoke.sound !== false,
        label: t('poke.sound'),
        onChange: function (value) {
          updatePoke({ sound: value });
        }
      })),
      h(Field, { label: t('poke.volume') }, h('div', { className: 'dsh-av-slider-row' },
        h('input', {
          type: 'range',
          className: 'dsh-av-slider',
          min: 0,
          max: 100,
          step: 1,
          value: String(volumeDraft),
          disabled: !!(snapshot && snapshot.readonly),
          'aria-label': t('poke.volume'),
          'aria-valuetext': String(volumeDraft) + '%',
          onChange: function (event) {
            setVolumeDraft(Number(event.target.value));
          },
          onPointerUp: commitVolume,
          onKeyUp: commitVolume,
          onBlur: commitVolume
        }),
        h('output', { className: 'dsh-av-slider-value' }, String(volumeDraft) + '%')
      )),
      h('div', { className: 'dsh-av-actions-inline' },
        h('button', {
          type: 'button',
          className: 'dsh-av-btn',
          onClick: handleTestPokeSound
        }, t('poke.test'))
      )
    ),
    h(
      Card,
      { title: t('globalDefaults'), hint: t('global.hint') },
      h(AvatarSlot, {
        side: 'user',
        shape: settings.shape,
        label: t('slot.user'),
        image: data.global.user || null,
        onPick: handlePick('global', 'user'),
        onClear: handleClear('global', 'user')
      }),
      h(AvatarSlot, {
        side: 'assistant',
        shape: settings.shape,
        label: t('slot.assistant'),
        image: data.global.assistant || null,
        onPick: handlePick('global', 'assistant'),
        onClear: handleClear('global', 'assistant')
      })
    ),
    h(
      CollapsibleCard,
      {
        title: t('workspaceOverrides'),
        hint: t('workspace.hint'),
        count: workspaces.length,
        open: !workspacesCollapsed,
        bodyId: 'dsh-av-workspaces-body',
        onToggle: handleToggleWorkspaces
      },
      workspaces.length === 0
        ? h('div', { className: 'dsh-av-hint' }, t('workspace.empty'))
        : workspaces.map(function (workspace) {
            const id = workspace && workspace.workspaceId;
            const entry =
              (id !== undefined && id !== null && data.workspaces[String(id)]) || { user: null, assistant: null };
            const scope = { workspaceId: id };
            return h(WorkspaceRow, {
              key: String(id),
              workspace: workspace,
              entry: entry,
              shape: settings.shape,
              currentWorkspaceId: currentWorkspaceId,
              onPick: function (side, file) {
                handlePick(scope, side)(file);
              },
              onClear: function (side) {
                handleClear(scope, side)();
              },
              onRestore: function () {
                messageForResult(store.clearWorkspace(id));
              }
            });
          })
    ),
    h(
      Card,
      { title: t('dataTools') },
      h(
        'div',
        { className: 'dsh-av-actions' },
        h(Button, { onClick: handleExport, disabled: busy !== null }, t('exportBackup')),
        h(Button, {
          onClick: function () {
            try {
              if (importRef.current) importRef.current.click();
            } catch (error) {}
          },
          disabled: busy !== null
        }, t('importBackup')),
        h(Button, {
          onClick: handleCleanOrphans,
          disabled: busy !== null || !workspacesReady || orphanCount === 0,
          title: workspacesReady ? undefined : t('notice.orphansUnavailable')
        }, confirmOrphans ? t('confirmOrphans') : t('cleanOrphans')),
        h(Button, { onClick: handleClearAll, danger: true, disabled: busy !== null }, confirmClear ? t('confirmClear') : t('clearAll'))
      ),
      h('input', {
        ref: importRef,
        type: 'file',
        accept: 'application/json,.json',
        style: { display: 'none' },
        onChange: function (event) {
          const input = event.target;
          const file = input.files && input.files[0];
          try {
            input.value = '';
          } catch (error) {}
          handleImportFile(file);
        }
      }),
      notice
        ? h(
            'div',
            {
              className: 'dsh-av-notice' + (notice.kind === 'error' ? ' dsh-av-notice-error' : ''),
              role: notice.kind === 'error' ? 'alert' : 'status'
            },
            notice.text
          )
        : null,
      busy ? h('div', { className: 'dsh-av-hint' }, busy) : null
    ),
    h(
      'details',
      { className: 'dsh-av-card dsh-av-diag' },
      h('summary', { className: 'dsh-av-card-title' }, t('diagnostics')),
      h('pre', { className: 'dsh-av-pre' }, JSON.stringify(buildSettingsDiagnostics(snapshot), null, 2)),
      h(Button, { onClick: handleCopyDiagnostics }, t('copyDiagnostics'))
    ),
    cropRequest
      ? h(CropDialog, {
          key: String(cropRequest.id),
          request: cropRequest,
          shape: settings.shape,
          onCancel: handleCancelCrop,
          onApply: handleApplyCrop
        })
      : null
  );
}
