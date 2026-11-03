export const LOCALES = ['en', 'es'] as const;
export type Locale = (typeof LOCALES)[number];

const en = {
  'app.title': 'Secure Section',
  'state.loading': 'Loading protected section…',
  'state.denied.title': 'This section is protected',
  'state.denied.body':
    'You do not have access to this content. If you need it, ask a section administrator to grant you access. Being able to view or edit this page does not grant access.',
  'state.unconfigured.title': 'Secure section not set up',
  'state.unconfigured.body':
    'This macro has not been set up on this page. Content from other pages or earlier copies of this page is never shown here.',
  'state.unconfigured.cannotCreate':
    'You need permission to edit this page to set up a secure section.',
  'state.unavailable.title': 'Temporarily unavailable',
  'state.unavailable.body':
    'We could not load this section right now. Nothing was changed. Please try again in a moment.',
  'state.corrupted.title': 'Content cannot be displayed',
  'state.corrupted.body':
    'The stored content failed an integrity check and was not displayed. Ask a section administrator to restore a previous revision.',
  'state.revoked.title': 'Your access was removed',
  'state.revoked.body':
    'Your access to this section changed. The content is no longer shown. Reload the page to see your current access.',
  'state.empty.title': 'This section is empty',
  'state.empty.body': 'No content has been added yet.',
  'action.create': 'Set up secure section',
  'action.retry': 'Try again',
  'action.edit': 'Edit',
  'action.save': 'Save',
  'action.cancel': 'Cancel',
  'action.reload': 'Reload',
  'action.discard': 'Discard changes',
  'action.close': 'Close',
  'action.confirm': 'Confirm',
  'action.add': 'Add',
  'action.remove': 'Remove',
  'action.restore': 'Restore this version',
  'action.copyRef': 'Show reference',
  'editor.label': 'Protected content editor',
  'editor.unsaved': 'You have unsaved changes.',
  'editor.leaveGuard': 'Discard unsaved changes?',
  'editor.saved': 'Saved.',
  'editor.saving': 'Saving…',
  'editor.pageEditRequired':
    'You can modify this section, but editing also requires permission to edit this page.',
  'editor.conflict.title': 'Someone else changed this section',
  'editor.conflict.body':
    'A newer version exists. Review the latest version, then re-apply your changes. Your draft is kept in this window only until you close it.',
  'editor.conflict.loadLatest': 'Load latest version',
  'editor.conflict.overwrite': 'Keep my draft and replace the latest version (it stays in History)',
  'editor.invalid': 'This content contains elements that are not allowed.',
  'editor.tooLarge': 'This content is too large to save.',
  'toolbar.bold': 'Bold',
  'toolbar.italic': 'Italic',
  'toolbar.strike': 'Strikethrough',
  'toolbar.code': 'Inline code',
  'toolbar.h2': 'Heading 2',
  'toolbar.h3': 'Heading 3',
  'toolbar.bullets': 'Bulleted list',
  'toolbar.numbers': 'Numbered list',
  'toolbar.quote': 'Quote',
  'toolbar.codeBlock': 'Code block',
  'toolbar.link': 'Link',
  'toolbar.table': 'Insert table',
  'toolbar.rule': 'Divider',
  'toolbar.undo': 'Undo',
  'toolbar.redo': 'Redo',
  'link.prompt': 'Link address (https://, http:// or mailto:)',
  'link.invalid': 'Only http, https and mailto links are allowed.',
  'nav.content': 'Content',
  'nav.permissions': 'Permissions',
  'nav.history': 'History',
  'nav.audit': 'Activity',
  'nav.help': 'Help',
  'nav.admin': 'Diagnostics',
  'role.VIEW': 'Can view',
  'role.MODIFY': 'Can edit',
  'role.ADMINISTER': 'Administrator',
  'role.none': 'No access',
  'perm.title': 'Who can access this section',
  'perm.explain':
    'Access is granted per section. Page permissions are checked separately and always apply.',
  'perm.search.users': 'Search people',
  'perm.search.groups': 'Search groups',
  'perm.add': 'Add access',
  'perm.user': 'Person',
  'perm.group': 'Group',
  'perm.inactive': 'Unavailable account or group',
  'perm.confirm.admin':
    'Give administrator access? Administrators can change who can read this content.',
  'perm.confirm.revoke': 'Remove this access?',
  'perm.lastAdmin':
    'At least one person must stay an administrator. Add another administrator first.',
  'perm.conflict':
    'Permissions changed while you were editing. Reloaded the latest list; try again.',
  'perm.saved': 'Permissions updated.',
  'perm.groupDegraded':
    'Group membership could not be checked right now. Group access may be temporarily missing.',
  'perm.effective': 'Your access',
  'perm.requestAccess':
    'Need access? Contact a section administrator. They can add you from this section’s Permissions tab. Administrators are shown on the Permissions tab of the section.',
  'history.title': 'Content versions',
  'history.restoreConfirm': 'Restore this version? A new version will be created.',
  'history.empty': 'No earlier versions.',
  'audit.title': 'Permission and activity log',
  'audit.note':
    'This log records who did what and when, never the content. It is tamper-evident, not tamper-proof.',
  'audit.chain.OK': 'Integrity check passed',
  'audit.chain.BROKEN': 'Integrity check failed: entries may have been altered',
  'audit.chain.PARTIAL':
    'Older entries were removed by retention; remaining entries are consistent',
  'wizard.title': 'Set up your secure section',
  'wizard.step1': 'You become the first administrator of this section.',
  'wizard.step2': 'Only people you add can read it, even if they can edit this page.',
  'wizard.step3': 'Add content, then use Permissions to share it.',
  'wizard.copyWarning':
    'Copying or moving this page does not copy secret content. A copied macro shows as not set up until someone with access copies it deliberately.',
  'help.title': 'Help and troubleshooting',
  'help.copyPage':
    'Copied this page and the section is empty? That is intentional. Use “Copy content from another section” with a reference from the source section.',
  'help.cannotSee': 'Cannot see the content? Ask a section administrator to add you.',
  'help.noEdit': 'Cannot edit? Editing needs both the Can edit role and page edit permission.',
  'bind.title': 'Use an existing section here',
  'bind.body':
    'Paste the reference shown by an administrator of the existing section. You must be an administrator of that section.',
  'bind.copy.title': 'Copy content from another section',
  'bind.copy.body':
    'Paste the reference from the source section. You need at least view access. You become the administrator of the new copy; its permissions start empty.',
  'bind.ref': 'Section reference',
  'bind.invalid': 'We could not use this reference. Check it and your access.',
  'admin.title': 'Diagnostics',
  'admin.note': 'Diagnostics never show protected content.',
  'recover.title': 'Administrator recovery',
  'recover.body':
    'Only a Confluence site administrator can do this, and only when the section has no active administrator. Type RECOVER to confirm. This is recorded in the activity log.',
  'error.generic': 'Something went wrong. Nothing was changed. Try again.',
  'error.denied': 'You do not have permission to do that.',
  'error.rate': 'Too many requests. Wait a moment and try again.',
  'a11y.status': 'Status',
  'ref.warning':
    'Treat this reference like a password. It cannot be used by itself to read content, but only share it with people who need to copy this section.',
  'header.default': 'Secure section',
  'header.shared': 'Access: {users} people · {groups} groups',
  'header.manage': 'Manage access',
  'class.INTERNAL': 'Internal',
  'class.CONFIDENTIAL': 'Confidential',
  'class.RESTRICTED': 'Restricted',
  'meta.title.label': 'Title',
  'meta.title.placeholder': 'For example: Q4 compensation plan',
  'meta.class.label': 'Classification',
  'meta.class.none': 'No classification',
  'meta.public.note':
    'The title and classification are visible to everyone who can view this page. Do not put confidential text in them.',
  'meta.edit': 'Edit details',
  'meta.saved': 'Details updated.',
  'content.savedBy': 'Saved by {name} · {when} · v{version}',
  'editor.words': '{count} words',
  'editor.shortcut': 'Ctrl+S saves',
} as const;

export type MessageKey = keyof typeof en;

const es: Record<MessageKey, string> = {
  'app.title': 'Sección segura',
  'state.loading': 'Cargando sección protegida…',
  'state.denied.title': 'Esta sección está protegida',
  'state.denied.body':
    'No tienes acceso a este contenido. Si lo necesitas, pide a un administrador de la sección que te dé acceso. Poder ver o editar la página no concede acceso.',
  'state.unconfigured.title': 'Sección segura sin configurar',
  'state.unconfigured.body':
    'Esta macro no se ha configurado en esta página. Nunca se muestra aquí contenido de otras páginas ni de copias anteriores.',
  'state.unconfigured.cannotCreate':
    'Necesitas permiso para editar esta página para configurar una sección segura.',
  'state.unavailable.title': 'No disponible temporalmente',
  'state.unavailable.body':
    'No pudimos cargar esta sección ahora. No se cambió nada. Inténtalo de nuevo en un momento.',
  'state.corrupted.title': 'No se puede mostrar el contenido',
  'state.corrupted.body':
    'El contenido almacenado no pasó una comprobación de integridad y no se mostró. Pide a un administrador de la sección que restaure una revisión anterior.',
  'state.revoked.title': 'Se retiró tu acceso',
  'state.revoked.body':
    'Tu acceso a esta sección cambió. El contenido ya no se muestra. Recarga la página para ver tu acceso actual.',
  'state.empty.title': 'Esta sección está vacía',
  'state.empty.body': 'Todavía no se ha añadido contenido.',
  'action.create': 'Configurar sección segura',
  'action.retry': 'Reintentar',
  'action.edit': 'Editar',
  'action.save': 'Guardar',
  'action.cancel': 'Cancelar',
  'action.reload': 'Recargar',
  'action.discard': 'Descartar cambios',
  'action.close': 'Cerrar',
  'action.confirm': 'Confirmar',
  'action.add': 'Añadir',
  'action.remove': 'Quitar',
  'action.restore': 'Restaurar esta versión',
  'action.copyRef': 'Mostrar referencia',
  'editor.label': 'Editor de contenido protegido',
  'editor.unsaved': 'Tienes cambios sin guardar.',
  'editor.leaveGuard': '¿Descartar los cambios sin guardar?',
  'editor.saved': 'Guardado.',
  'editor.saving': 'Guardando…',
  'editor.pageEditRequired':
    'Puedes modificar esta sección, pero editarla también requiere permiso para editar esta página.',
  'editor.conflict.title': 'Otra persona cambió esta sección',
  'editor.conflict.body':
    'Existe una versión más reciente. Revisa la última versión y vuelve a aplicar tus cambios. Tu borrador solo se conserva en esta ventana hasta que la cierres.',
  'editor.conflict.loadLatest': 'Cargar la última versión',
  'editor.conflict.overwrite':
    'Conservar mi borrador y reemplazar la última versión (queda en el Historial)',
  'editor.invalid': 'Este contenido incluye elementos que no están permitidos.',
  'editor.tooLarge': 'Este contenido es demasiado grande para guardarlo.',
  'toolbar.bold': 'Negrita',
  'toolbar.italic': 'Cursiva',
  'toolbar.strike': 'Tachado',
  'toolbar.code': 'Código en línea',
  'toolbar.h2': 'Encabezado 2',
  'toolbar.h3': 'Encabezado 3',
  'toolbar.bullets': 'Lista con viñetas',
  'toolbar.numbers': 'Lista numerada',
  'toolbar.quote': 'Cita',
  'toolbar.codeBlock': 'Bloque de código',
  'toolbar.link': 'Enlace',
  'toolbar.table': 'Insertar tabla',
  'toolbar.rule': 'Separador',
  'toolbar.undo': 'Deshacer',
  'toolbar.redo': 'Rehacer',
  'link.prompt': 'Dirección del enlace (https://, http:// o mailto:)',
  'link.invalid': 'Solo se permiten enlaces http, https y mailto.',
  'nav.content': 'Contenido',
  'nav.permissions': 'Permisos',
  'nav.history': 'Historial',
  'nav.audit': 'Actividad',
  'nav.help': 'Ayuda',
  'nav.admin': 'Diagnóstico',
  'role.VIEW': 'Puede ver',
  'role.MODIFY': 'Puede editar',
  'role.ADMINISTER': 'Administrador',
  'role.none': 'Sin acceso',
  'perm.title': 'Quién puede acceder a esta sección',
  'perm.explain':
    'El acceso se concede por sección. Los permisos de la página se comprueban aparte y siempre se aplican.',
  'perm.search.users': 'Buscar personas',
  'perm.search.groups': 'Buscar grupos',
  'perm.add': 'Añadir acceso',
  'perm.user': 'Persona',
  'perm.group': 'Grupo',
  'perm.inactive': 'Cuenta o grupo no disponible',
  'perm.confirm.admin':
    '¿Dar acceso de administrador? Los administradores pueden cambiar quién puede leer este contenido.',
  'perm.confirm.revoke': '¿Quitar este acceso?',
  'perm.lastAdmin':
    'Debe quedar al menos una persona como administradora. Añade antes a otro administrador.',
  'perm.conflict':
    'Los permisos cambiaron mientras editabas. Se recargó la lista más reciente; inténtalo de nuevo.',
  'perm.saved': 'Permisos actualizados.',
  'perm.groupDegraded':
    'No se pudo comprobar la pertenencia a grupos ahora. El acceso por grupo puede faltar temporalmente.',
  'perm.effective': 'Tu acceso',
  'perm.requestAccess':
    '¿Necesitas acceso? Contacta con un administrador de la sección. Puede añadirte desde la pestaña Permisos de la sección.',
  'history.title': 'Versiones del contenido',
  'history.restoreConfirm': '¿Restaurar esta versión? Se creará una versión nueva.',
  'history.empty': 'No hay versiones anteriores.',
  'audit.title': 'Registro de permisos y actividad',
  'audit.note':
    'Este registro indica quién hizo qué y cuándo, nunca el contenido. Es evidente ante manipulaciones, pero no a prueba de ellas.',
  'audit.chain.OK': 'Comprobación de integridad superada',
  'audit.chain.BROKEN':
    'Comprobación de integridad fallida: las entradas pueden haber sido alteradas',
  'audit.chain.PARTIAL': 'La retención eliminó entradas antiguas; las restantes son coherentes',
  'wizard.title': 'Configura tu sección segura',
  'wizard.step1': 'Serás la primera persona administradora de esta sección.',
  'wizard.step2': 'Solo las personas que añadas podrán leerla, aunque puedan editar esta página.',
  'wizard.step3': 'Añade contenido y usa Permisos para compartirlo.',
  'wizard.copyWarning':
    'Copiar o mover esta página no copia el contenido secreto. Una macro copiada aparece sin configurar hasta que alguien con acceso la copie deliberadamente.',
  'help.title': 'Ayuda y solución de problemas',
  'help.copyPage':
    '¿Copiaste la página y la sección está vacía? Es intencional. Usa «Copiar contenido de otra sección» con una referencia de la sección original.',
  'help.cannotSee': '¿No ves el contenido? Pide a un administrador de la sección que te añada.',
  'help.noEdit':
    '¿No puedes editar? Hace falta el rol Puede editar y también permiso de edición de la página.',
  'bind.title': 'Usar aquí una sección existente',
  'bind.body':
    'Pega la referencia que muestra un administrador de la sección existente. Debes ser administrador de esa sección.',
  'bind.copy.title': 'Copiar contenido de otra sección',
  'bind.copy.body':
    'Pega la referencia de la sección de origen. Necesitas al menos acceso de lectura. Serás administrador de la nueva copia; sus permisos empiezan vacíos.',
  'bind.ref': 'Referencia de la sección',
  'bind.invalid': 'No pudimos usar esta referencia. Revísala y revisa tu acceso.',
  'admin.title': 'Diagnóstico',
  'admin.note': 'El diagnóstico nunca muestra contenido protegido.',
  'recover.title': 'Recuperación de administrador',
  'recover.body':
    'Solo un administrador del sitio de Confluence puede hacerlo, y solo cuando la sección no tiene ningún administrador activo. Escribe RECOVER para confirmar. Queda registrado en el registro de actividad.',
  'error.generic': 'Algo salió mal. No se cambió nada. Inténtalo de nuevo.',
  'error.denied': 'No tienes permiso para hacer eso.',
  'error.rate': 'Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.',
  'a11y.status': 'Estado',
  'ref.warning':
    'Trata esta referencia como una contraseña. Por sí sola no permite leer el contenido, pero compártela solo con quien necesite copiar esta sección.',
  'header.default': 'Sección segura',
  'header.shared': 'Acceso: {users} personas · {groups} grupos',
  'header.manage': 'Gestionar acceso',
  'class.INTERNAL': 'Interno',
  'class.CONFIDENTIAL': 'Confidencial',
  'class.RESTRICTED': 'Restringido',
  'meta.title.label': 'Título',
  'meta.title.placeholder': 'Por ejemplo: Plan de compensación Q4',
  'meta.class.label': 'Clasificación',
  'meta.class.none': 'Sin clasificación',
  'meta.public.note':
    'El título y la clasificación los ve cualquiera que pueda ver esta página. No pongas texto confidencial en ellos.',
  'meta.edit': 'Editar detalles',
  'meta.saved': 'Detalles actualizados.',
  'content.savedBy': 'Guardado por {name} · {when} · v{version}',
  'editor.words': '{count} palabras',
  'editor.shortcut': 'Ctrl+S guarda',
};

const CATALOGS: Record<Locale, Record<MessageKey, string>> = { en, es };

export function resolveLocale(input: string | undefined | null): Locale {
  if (!input) return 'en';
  const base = input.toLowerCase().split(/[-_]/)[0];
  return (LOCALES as readonly string[]).includes(base ?? '') ? (base as Locale) : 'en';
}

export function t(
  locale: Locale,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  let s = CATALOGS[locale][key] ?? CATALOGS.en[key];
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

export function catalogKeys(locale: Locale): MessageKey[] {
  return Object.keys(CATALOGS[locale]) as MessageKey[];
}
