// Learn more https://docs.expo.io/guides/customizing-metro
/**
 * @type {import('expo/metro-config').MetroConfig}
 */
const { getDefaultConfig } = require('expo/metro-config')
const { withTamagui } = require('@tamagui/metro-plugin')

const config = getDefaultConfig(__dirname, {
    // [Web-only]: Enables CSS support in Metro.
    isCSSEnabled: true,
})

config.resolver.sourceExts.push('mjs')
config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName.includes('zustand')) {
        const result = require.resolve(moduleName) // gets CommonJS version
        return context.resolveRequest(context, result, platform)
    }
    // otherwise chain to the standard Metro resolver.
    return context.resolveRequest(context, moduleName, platform)
}

module.exports = withTamagui(config, {
    components: ['tamagui'],
    config: './tamagui.config.ts',
    outputCSS: './tamagui-web.css',
})
