<?php
declare(strict_types=1);
namespace OCP { interface IUserSession { public function getUser(); } class Util { public static function addInitScript(...$args) {} public static function addStyle(...$args) {} } }
namespace OCP\App { interface IAppManager { public function isEnabledForUser($app, $user): bool; } }
namespace OCP\AppFramework { class App { public function __construct($id) {} } }
namespace OCP\AppFramework\Bootstrap {
    interface IBootstrap {} interface IRegistrationContext {} interface IBootContext { public function injectFn(callable $fn); }
}
namespace OCP\AppFramework\Services { interface IInitialState { public function provideLazyInitialState(string $key, \Closure $fn): void; } }
namespace {
require __DIR__ . '/../lib/AppInfo/Application.php';
foreach ([true, false, null] as $enabled) {
    $user = $enabled === null ? null : (object)['uid' => 'test'];
    $state = new class implements \OCP\AppFramework\Services\IInitialState {
        public array $callbacks = [];
        public function provideLazyInitialState(string $key, \Closure $fn): void { $this->callbacks[$key] = $fn; }
    };
    $apps = new class($enabled, $user) implements \OCP\App\IAppManager {
        public int $calls = 0;
        public function __construct(private $enabled, private $user) {}
        public function isEnabledForUser($app, $user): bool {
            if ($app !== 'mjms_pdf_manager' || $user !== $this->user) throw new \Exception('Wrong app or user');
            $this->calls++;
            return $this->enabled;
        }
    };
    $session = new class($user) implements \OCP\IUserSession {
        public function __construct(private $user) {}
        public function getUser() { return $this->user; }
    };
    $context = new class($state, $apps, $session) implements \OCP\AppFramework\Bootstrap\IBootContext {
        public function __construct(private $state, private $apps, private $session) {}
        public function injectFn(callable $fn) { $fn($this->state, $this->apps, $this->session); }
    };
    (new \OCA\MJMSPdfViewer\AppInfo\Application())->boot($context);
    if ($apps->calls !== 0) throw new \Exception('Manager state must be lazy');
    if ($state->callbacks['manager-enabled']() !== ($enabled === true)) throw new \Exception('Wrong initial state');
    if ($apps->calls !== ($enabled === null ? 0 : 1)) throw new \Exception('Anonymous check must stay disabled');
}
echo "PASS lazy Manager initial state, user enablement and anonymous page\n";
}
