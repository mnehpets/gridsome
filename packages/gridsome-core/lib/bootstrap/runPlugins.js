const pMap = require('p-map')
const { internalRE } = require('./index')
const { defaultsDeep } = require('lodash')
const { NORMAL_PLUGIN, SOURCE_PLUGIN } = require('../utils/enums')

module.exports = service => {
  let regenerateTimeout = null

  // use timeout as a workaround for when files are renamed,
  // which triggers both add and unlink events...
  const regenerateRoutes = () => {
    clearTimeout(regenerateTimeout)
    regenerateTimeout = setTimeout(() => {
      service.generateRoutes()
    }, 20)
  }

  return pMap(service.config.plugins, async plugin => {
    const use = plugin.use.replace(internalRE, '../')
    const PluginClass = require(use)
    const defaults = PluginClass.defaultOptions()
    const options = defaultsDeep(plugin.options, defaults)
    const { context, store, transformers, logger } = service

    switch (plugin.type) {
      case NORMAL_PLUGIN:
        plugin.instance = new PluginClass(context, options)

        break

      case SOURCE_PLUGIN:
        plugin.instance = new PluginClass(
          context, options, store, transformers, logger
        )

        break
    }

    plugin.instance.onBefore()
    await plugin.instance.apply()
    plugin.instance.onAfter()

    if (process.env.NODE_ENV === 'development' && plugin.type === SOURCE_PLUGIN) {
      plugin.instance.on('removePage', regenerateRoutes)
      plugin.instance.on('addPage', regenerateRoutes)

      plugin.instance.on('updatePage', async (page, oldPage) => {
        const { pageQuery: { paginate: oldPaginate }} = oldPage
        const { pageQuery: { paginate }} = page

        // regenerate route.js whenever paging options changes
        if (paginate.collection !== oldPaginate.collection) {
          await service.generateRoutes()
        }

        // send query to front-end for re-fetch
        service.broadcast({
          query: page.pageQuery.content,
          file: page.file
        })
      })
    }
  }, { concurrency: 3 })
}
