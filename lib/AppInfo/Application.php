<?php
namespace OCA\MJMSPdfViewer\AppInfo;

use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IRegistrationContext;
use OCP\Util;
use OCP\App\IAppManager;
use OCP\AppFramework\Services\IInitialState;
use OCP\IUserSession;

class Application extends App implements IBootstrap {
    public const APP_ID = 'mjms_pdf_viewer';

    public function __construct() {
        parent::__construct(self::APP_ID);
    }

    public function register(IRegistrationContext $context): void {
    }

    public function boot(IBootContext $context): void {
        $context->injectFn(function (IInitialState $state, IAppManager $apps, IUserSession $session): void {
            // Evaluate after boot, when authentication and all apps are ready.
            $state->provideLazyInitialState('manager-enabled', function () use ($apps, $session): bool {
                $user = $session->getUser();
                return $user !== null && $apps->isEnabledForUser('mjms_pdf_manager', $user);
            });
        });
        Util::addInitScript(self::APP_ID, 'mjms_pdf_viewer-main');
        Util::addStyle(self::APP_ID, 'viewer');
    }
}