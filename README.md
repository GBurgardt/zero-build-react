# Zero-Build React

🚀 **React sin build, directo a producción en segundos**

## Características

- ⚡ **NO HAY BUILD** - Solo Git push y ya está en producción
- 📦 React cargado desde CDN via Import Maps
- 🎯 Deploy en 2-3 segundos (vs 2-3 minutos con build tradicional)
- 🔥 Desarrollo directo en producción
- 🎨 App demo con PokeAPI

## Stack

- React 18.2 (desde esm.sh CDN)
- Import Maps nativos del browser
- PM2 para servir estáticos
- Nginx para reverse proxy
- EC2 AWS Linux

## Estructura

```
/
├── public/
│   └── index.html    # HTML con Import Maps
├── src/
│   └── app.js       # React puro (sin JSX transpilado)
└── deploy.sh        # Script de deploy (push + pull)
```

## Deploy

```bash
./deploy.sh
```

El deploy hace:
1. Git push a GitHub
2. SSH al servidor
3. Git pull 
4. Listo! (no hay build)

## URLs

- Producción: https://zero.getreels.app
- Repo: https://github.com/germanburgardt/zero-build-react
