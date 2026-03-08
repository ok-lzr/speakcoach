@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: 配置GitHub仓库信息
set REPO_URL=https://github.com/ok-lzr/speakcoach.git
set COMMIT_MSG=自动提交: %date% %time%

echo ========================================
echo      开始推送文件到GitHub仓库
echo ========================================
echo.

:: 检查是否已初始化Git仓库
if not exist ".git" (
    echo 初始化Git仓库...
    git init
    if !errorlevel! neq 0 (
        echo [错误] Git初始化失败，请确保已安装Git
        pause
        exit /b 1
    )
)

:: 检查远程仓库是否已配置
git remote -v | find "origin" >nul
if !errorlevel! neq 0 (
    echo 添加远程仓库...
    git remote add origin %REPO_URL%
    if !errorlevel! neq 0 (
        echo [错误] 添加远程仓库失败
        pause
        exit /b 1
    )
) else (
    echo 远程仓库已存在，检查URL是否正确...
    git remote set-url origin %REPO_URL%
)

:: 添加所有文件到暂存区
echo 添加文件到暂存区...
git add .
if !errorlevel! neq 0 (
    echo [错误] 添加文件失败
    pause
    exit /b 1
)

:: 检查是否有文件需要提交
git status | find "nothing to commit" >nul
if !errorlevel! equ 0 (
    echo 没有文件需要提交
) else (
    :: 提交更改
    echo 提交更改...
    git commit -m "%COMMIT_MSG%"
    if !errorlevel! neq 0 (
        echo [错误] 提交失败
        pause
        exit /b 1
    )
)

:: 推送到GitHub
echo 推送到GitHub...
git push -u origin master
if !errorlevel! neq 0 (
    echo [错误] 推送失败，可能需要先拉取最新代码
    echo 尝试先拉取再推送...
    
    :: 拉取最新代码并合并
    git pull origin master --allow-unrelated-histories
    if !errorlevel! equ 0 (
        echo 重新推送...
        git push origin master
        if !errorlevel! neq 0 (
            echo [错误] 推送仍然失败
            pause
            exit /b 1
        )
    ) else (
        echo [错误] 拉取失败
        pause
        exit /b 1
    )
)

echo.
echo ========================================
echo      推送完成！
echo ========================================
echo.
pause