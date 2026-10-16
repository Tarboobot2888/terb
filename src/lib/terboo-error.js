import config from '../../config.js'
function te(prefix, command, pushName) {
    // نفس القالب الافتراضي في config.js؛ يُترجم للمستلم عند الإرسال (§30)
    const tpl = config.errorTemplate || `☢ يبدو أن الأمر {prefix}{command} يواجه مشكلة\nحاول مرة أخرى لاحقاً، {pushName}\n\n_إذا استمرت المشكلة، تواصل مع مالك البوت_`
    return tpl
        .replace(/\{prefix\}/g, prefix || '.')
        .replace(/\{command\}/g, command || '?')
        .replace(/\{pushName\}/g, pushName || '')
}

export default te